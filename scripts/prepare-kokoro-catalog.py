import pathlib, zipfile, email, hashlib, json, urllib.request, re
root = pathlib.Path.cwd()
catalog_path = root/'electron/module-catalog.json'
catalog = json.loads(catalog_path.read_text())
wheels = []
notice_dir = root/'public/licenses/kokoro'
notice_dir.mkdir(parents=True, exist_ok=True)
notice_entries = []
for file in sorted((root/'.cache/kokoro-wheels').glob('*.whl')):
    with zipfile.ZipFile(file) as z:
        metadata = email.message_from_bytes(z.read(next(n for n in z.namelist() if n.endswith('.dist-info/METADATA'))))
        name, version = metadata['Name'], metadata['Version']
        data = json.load(urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json'))
        artifact = next(f for f in data['urls'] if f['filename']==file.name)
        sha = hashlib.sha256(file.read_bytes()).hexdigest()
        assert sha == artifact['digests']['sha256'] and file.stat().st_size == artifact['size']
        source = data['info'].get('project_urls') or {}
        source = source.get('Source') or source.get('Source code') or source.get('Repository') or source.get('Homepage') or f'https://pypi.org/project/{name}/{version}/'
        license_name = metadata.get('License-Expression') or data['info'].get('license') or 'See retained license texts'
        if name=='espeakng-loader': license_name='MIT loader; GPL-3.0-or-later eSpeak NG'
        if name=='kokoro-onnx': license_name='MIT'
        if name=='phonemizer': license_name='GPL-3.0-or-later'
        wheels.append(dict(name=file.name,url=artifact['url'],sha256=sha,bytes=artifact['size'],package=name,version=version,license=license_name,source=source))
        for n in z.namelist():
            if not n.endswith('/') and re.search(r'(?:^|/)(LICENSE|LICENCE|COPYING|NOTICE|ThirdPartyNotices|COPYRIGHT)(?:[._-]|$)', n, re.I):
                dest=hashlib.sha256((name+' '+version+' '+n).encode()).hexdigest()[:20]+'.txt'
                (notice_dir/dest).write_bytes(z.read(n))
                notice_entries.append(dict(id='kokoro-'+dest[:-4],title=f'{name} {version} · {n}',file='kokoro/'+dest))
        if name=='kokoro-onnx':
            header=z.read('kokoro_onnx/trim.py').decode().split('"""')[1]
            (notice_dir/'LIBROSA-ISC.txt').write_text(header,encoding='utf-8')
            notice_entries.append(dict(id='kokoro-librosa',title='Kokoro trimming code · librosa ISC notice',file='kokoro/LIBROSA-ISC.txt'))
requirements=''.join(f"{w['package']}=={w['version']} --hash=sha256:{w['sha256']}\n" for w in wheels)
(root/'electron/module-locks/kokoro.txt').write_text(requirements,encoding='utf-8',newline='\n')
repo='onnx-community/Kokoro-82M-v1.0-ONNX'
info=json.load(urllib.request.urlopen('https://huggingface.co/api/models/'+repo))
revision='1939ad2a8e416c0acfeecc08a694d14ef25f2231'
files=json.load(urllib.request.urlopen(f'https://huggingface.co/api/models/{repo}/tree/{revision}?recursive=true'))
model_files=[]
for remote in ['onnx/model.onnx','voices/af_heart.bin','voices/af_bella.bin','voices/am_michael.bin','README.md']:
    item=next(f for f in files if f['path']==remote)
    url=f'https://huggingface.co/{repo}/resolve/{revision}/{remote}'
    sha=item.get('lfs',{}).get('oid')
    if not sha: sha=hashlib.sha256(urllib.request.urlopen(url).read()).hexdigest()
    model_files.append(dict(name=remote.split('/')[-1],url=url,sha256=sha,bytes=item['size']))
entry=dict(id='kokoro',name='Kokoro speech',version='0.6.1',import_='kokoro_onnx',license='MIT runtime · GPLv3 phonemizer',source='https://github.com/thewh1teagle/kokoro-onnx',requirementsSHA256=hashlib.sha256(requirements.encode()).hexdigest(),model=dict(id='kokoro-82m-v1-fp32-en',revision=revision,license='Apache-2.0',source='https://huggingface.co/'+repo,files=model_files,name='Kokoro-82M · English',language='en-US'),wheels=wheels)
entry['import']=entry.pop('import_')
catalog['modules']=[m for m in catalog['modules'] if m['id']!='kokoro']+[entry]
catalog_path.write_text(json.dumps(catalog,indent=2)+'\n',encoding='utf-8')
(notice_dir/'index.json').write_text(json.dumps(notice_entries,indent=2)+'\n')
print(json.dumps(dict(engine_version=entry['version'],revision=revision,model_bytes=sum(f['bytes'] for f in model_files),wheels=len(wheels),notices=len(notice_entries))))
