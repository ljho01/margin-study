//! Keeps the macOS traffic lights centered in the 44px app header.
//!
//! tao applies `trafficLightPosition` only when its own view redraws, which
//! the full-window webview almost never triggers. AppKit re-tiles the title
//! bar on several events (for example when the window starts being shared or
//! captured): it shrinks the bar to its default height and moves the buttons
//! back to their default spot, sometimes in several passes. The inset is
//! re-applied whenever AppKit moves them, and once more on the next run loop
//! turn to catch passes made after the notifications.

use std::{cell::Cell, ptr::NonNull};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2_app_kit::{
    NSView, NSViewFrameDidChangeNotification, NSWindow, NSWindowButton,
    NSWindowDidBecomeKeyNotification, NSWindowDidEndLiveResizeNotification,
    NSWindowDidExitFullScreenNotification, NSWindowDidResizeNotification, NSWindowStyleMask,
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSRunLoop, NSString};

/// Matches `trafficLightPosition` in tauri.conf.json: buttons start 15pt from
/// the left and their bar is 24pt taller than a button.
const X: f64 = 15.0;
const Y: f64 = 24.0;
/// (44pt header - 14pt button) / 2, so the buttons sit centered in the header.
const TOP: f64 = 15.0;

thread_local! {
    static PLACING: Cell<bool> = const { Cell::new(false) };
    static AGAIN: Cell<bool> = const { Cell::new(false) };
    static QUEUED: Cell<bool> = const { Cell::new(false) };
}

fn buttons(window: &NSWindow) -> Option<[Retained<objc2_app_kit::NSButton>; 3]> {
    Some([
        window.standardWindowButton(NSWindowButton::CloseButton)?,
        window.standardWindowButton(NSWindowButton::MiniaturizeButton)?,
        window.standardWindowButton(NSWindowButton::ZoomButton)?,
    ])
}

fn container(window: &NSWindow) -> Option<Retained<NSView>> {
    let close = window.standardWindowButton(NSWindowButton::CloseButton)?;
    unsafe { close.superview()?.superview() }
}

/// Moves the bar and buttons into place; only touches frames that are off.
fn apply(window: &NSWindow) {
    if let (Some([close, mini, zoom]), Some(bar)) = (buttons(window), container(window)) {
        let close_frame = close.frame();
        let height = close_frame.size.height + Y;
        let mut bar_frame = bar.frame();
        let spacing = mini.frame().origin.x - close_frame.origin.x;
        let top = window.frame().size.height - height;
        if (bar_frame.size.height - height).abs() > 0.5 || (bar_frame.origin.y - top).abs() > 0.5 {
            bar_frame.size.height = height;
            bar_frame.origin.y = top;
            bar.setFrame(bar_frame);
        }
        for (i, button) in [close, mini, zoom].iter().enumerate() {
            let frame = button.frame();
            let mut origin = frame.origin;
            let x = X + i as f64 * spacing;
            let y = height - TOP - frame.size.height;
            if (origin.x - x).abs() > 0.5 || (origin.y - y).abs() > 0.5 {
                origin.x = x;
                origin.y = y;
                button.setFrameOrigin(origin);
            }
        }
    }
}

fn place(window: &NSWindow) {
    // In full screen (and while entering or leaving it) AppKit moves the
    // buttons into a separate title bar window. Re-placing them there fights
    // AppKit's own layout in an endless loop that freezes the app; leave them
    // alone until DidExitFullScreen.
    if window.styleMask().contains(NSWindowStyleMask::FullScreen) {
        return;
    }
    // AppKit can move the buttons again while they are being placed; repeat
    // until a pass finishes without interference.
    if PLACING.with(|p| p.replace(true)) {
        AGAIN.with(|a| a.set(true));
        return;
    }
    for _ in 0..4 {
        AGAIN.with(|a| a.set(false));
        apply(window);
        if !AGAIN.with(|a| a.get()) {
            break;
        }
    }
    PLACING.with(|p| p.set(false));
}

fn place_soon(window: &Retained<NSWindow>) {
    place(window);
    if QUEUED.with(|q| q.replace(true)) {
        return;
    }
    let target = window.clone();
    let block = RcBlock::new(move || {
        QUEUED.with(|q| q.set(false));
        place(&target);
    });
    unsafe { NSRunLoop::mainRunLoop().performBlock(&block) };
}

/// Must run on the main thread.
pub fn pin(window: &tauri::WebviewWindow) {
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    let Some(ns_window) = (unsafe { Retained::retain(pointer as *mut NSWindow) }) else {
        return;
    };
    place(&ns_window);
    let center = NSNotificationCenter::defaultCenter();
    let target = ns_window.clone();
    let block = RcBlock::new(move |_: NonNull<NSNotification>| place_soon(&target));
    let observe = |name: &NSString, object: &objc2::runtime::AnyObject| {
        let token = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(name),
                Some(object),
                None,
                &block,
            )
        };
        // Observers live as long as the window, which lives as long as the app.
        std::mem::forget(token);
    };
    unsafe {
        for name in [
            NSWindowDidResizeNotification,
            NSWindowDidEndLiveResizeNotification,
            NSWindowDidBecomeKeyNotification,
            NSWindowDidExitFullScreenNotification,
        ] {
            observe(name, &ns_window);
        }
        if let Some([close, ..]) = buttons(&ns_window) {
            close.setPostsFrameChangedNotifications(true);
            observe(NSViewFrameDidChangeNotification, &close);
        }
        if let Some(bar) = container(&ns_window) {
            bar.setPostsFrameChangedNotifications(true);
            observe(NSViewFrameDidChangeNotification, &bar);
        }
    }
}
