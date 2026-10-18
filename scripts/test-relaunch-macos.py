#!/usr/bin/env python3
"""macOS integration smoke: python3 scripts/test-relaunch-macos.py.

Uses an isolated accessory app and the production restart helper. Does not
launch, quit, update, or change Dock preferences for the installed study app.
Requires Xcode command-line tools and a logged-in macOS desktop session.
"""
import ctypes, json, os, pathlib, plistlib, shutil, subprocess, tempfile, time
root = pathlib.Path(tempfile.mkdtemp(prefix='margin-relaunch-'))
app = root / "여백 ' relaunch.app"
trace = root / 'events.jsonl'
source = root / 'main.m'
source.write_text(r'''#import <Cocoa/Cocoa.h>
static void record(NSString *event, NSString *version) {
    NSDictionary *row = @{ @"event":event, @"version":version, @"pid":@(getpid()), @"path":NSBundle.mainBundle.bundlePath };
    NSData *data = [NSJSONSerialization dataWithJSONObject:row options:0 error:nil];
    NSFileHandle *file = [NSFileHandle fileHandleForWritingAtPath:@"TRACE_PATH"];
    [file seekToEndOfFile]; [file writeData:data]; [file writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]]; [file closeFile];
}
int main() { @autoreleasepool {
    NSApplication *app=NSApplication.sharedApplication;
    [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
    NSString *version=[NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleVersion"];
    record(@"start",version);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 6*NSEC_PER_SEC),dispatch_get_main_queue(),^{record(@"exit",version); [app terminate:nil];});
    [app run];
} return 0; }
'''.replace('TRACE_PATH',str(trace)))
trace.touch()
(app/'Contents/MacOS').mkdir(parents=True)
info={'CFBundleIdentifier':'com.jaeho.margin-relaunch-smoke','CFBundleName':'Margin Relaunch Smoke','CFBundleExecutable':'fixture','CFBundlePackageType':'APPL','CFBundleVersion':'1','LSUIElement':True}
with (app/'Contents/Info.plist').open('wb') as f: plistlib.dump(info,f)
subprocess.run(['clang','-w','-fobjc-arc','-framework','Cocoa',str(source),'-o',str(app/'Contents/MacOS/fixture')],check=True)
subprocess.run(['codesign','--force','--sign','-',str(app)],check=True,capture_output=True)
helper=str(pathlib.Path(__file__).resolve().parents[1] / 'src-tauri/src/relaunch-macos.sh')
registrar='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
def events(): return [json.loads(s) for s in trace.read_text().splitlines()]
def wait_for(n):
    until=time.monotonic()+20
    while len(events())<n and time.monotonic()<until: time.sleep(.1)
    assert len(events())>=n,events()
try:
    subprocess.run(['open',str(app)],check=True)
    wait_for(1)
    old=events()[0]['pid']
    staged=root/'staged.app'
    shutil.copytree(app,staged)
    info['CFBundleVersion']='2'
    with (staged/'Contents/Info.plist').open('wb') as f: plistlib.dump(info,f)
    subprocess.run(['codesign','--force','--sign','-',str(staged)],check=True,capture_output=True)
    libc=ctypes.CDLL(None,use_errno=True)
    assert libc.renamex_np(os.fsencode(app),os.fsencode(staged),2)==0,ctypes.get_errno()
    shutil.rmtree(staged)
    proc=subprocess.Popen(['/bin/sh',helper,str(old),str(app)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    time.sleep(1)
    assert len(events())==1,events()
    out,err=proc.communicate(timeout=20)
    assert proc.returncode==0,(out,err)
    wait_for(3)
    rows=events()
    assert [(r['event'],r['version']) for r in rows[:3]]==[('start','1'),('exit','1'),('start','2')],rows
    assert rows[0]['path']==rows[2]['path'],rows
    # A second restart request after a user already opened v2 must reuse v2.
    subprocess.run(['/bin/sh',helper,str(old),str(app)],check=True,capture_output=True)
    time.sleep(.5)
    assert len([r for r in events() if r['event']=='start'])==2,events()
    wait_for(4)
    missing=subprocess.run(['/bin/sh',helper,str(old),str(root/'missing.app')],capture_output=True)
    assert missing.returncode!=0
    print(json.dumps({'passed':['atomic bundle replacement','exit before relaunch','same Unicode bundle path','existing instance reused','missing bundle rejected'],'events':events()},ensure_ascii=False,indent=2))
finally:
    subprocess.run([registrar,'-u',str(app)],capture_output=True)
    shutil.rmtree(root)
