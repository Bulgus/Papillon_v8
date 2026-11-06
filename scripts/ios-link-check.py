"""
Static dyld check for a built Papillon.app: every symbol a binary of the app
imports from one of the app's own frameworks must be exported by it.
Catches the launch crash "Symbol not found ... Expected in React.framework"
(mismatched expo-modules-core / react-native) before the IPA ships.

Usage: python3 scripts/ios-link-check.py path/to/Papillon.app
"""
import struct,sys,os,glob
def slice64(d):
    m=struct.unpack('<I',d[:4])[0]
    if m in (0xbebafeca,):
        n=struct.unpack('>I',d[4:8])[0]
        for i in range(n):
            cpu,sub,o,sz,al=struct.unpack('>iiIII',d[8+i*20:28+i*20])
            if cpu==0x0100000c: return o
    return 0
def parse(path):
    d=open(path,'rb').read(); off=slice64(d)
    if struct.unpack('<I',d[off:off+4])[0]!=0xfeedfacf: return None
    ncmds=struct.unpack('<I',d[off+16:off+20])[0]; p=off+32
    dylibs=[]; symtab=None; weakset=set()
    for _ in range(ncmds):
        cmd,size=struct.unpack('<II',d[p:p+8])
        if cmd in (0xc,0x80000018,0x8000001f,0x80000023):
            no=struct.unpack('<I',d[p+8:p+12])[0]; dylibs.append((d[p+no:p+size].split(b'\0')[0].decode(), cmd==0x80000018))
        if cmd==0x2: symtab=struct.unpack('<IIII',d[p+8:p+24])
        p+=size
    und=[];defs=set()
    if symtab:
        so,ns,stro,strs=symtab
        for i in range(ns):
            e=off+so+i*16
            nstrx,ntype,nsect,ndesc,nval=struct.unpack('<IBBHQ',d[e:e+16])
            name=d[off+stro+nstrx:].split(b'\0',1)[0].decode('latin1')
            t=ntype&0x0e
            if ntype&0xe0: continue
            if t==0x0 and ntype&1:
                lib=(ndesc>>8)&0xff
                und.append((name,lib,bool(ndesc&0x40)))
            elif t==0xe and ntype&1: defs.add(name)
    return dylibs,und,defs
app=sys.argv[1]
bins={}
for f in [os.path.join(app,'Papillon')]+glob.glob(app+'/Frameworks/*.framework')+glob.glob(app+'/PlugIns/*.appex'):
    if f.endswith('.framework'): b=os.path.join(f,os.path.basename(f)[:-10]); key='@rpath/'+os.path.basename(f)+'/'+os.path.basename(f)[:-10]
    elif f.endswith('.appex'): b=os.path.join(f,os.path.basename(f)[:-6]); key=None
    else: b=f; key=None
    r=parse(b)
    if r: bins[b]=(key,r)
exports={k:r[2] for b,(k,r) in bins.items() if k}
problems=0
for b,(k,(dylibs,und,defs)) in bins.items():
    for name,lib,weak in und:
        if lib in (0,0xfe,0xff) or lib>len(dylibs): continue
        path,weaklib=dylibs[lib-1]
        if path in exports and name not in exports[path] and not weak and not weaklib:
            problems+=1
            if problems<20: print('MISSING',name,'needed by',os.path.basename(b),'from',os.path.basename(path))
print('binaries',len(bins),'problems',problems)
sys.exit(1 if problems else 0)
