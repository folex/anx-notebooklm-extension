from pathlib import Path
import zipfile,json
root=Path(__file__).parent
version=json.loads((root/'manifest.json').read_text())['version']
output=root/'dist'/f'NotebookLM-{version}.anxplugin';output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
 for name in ['manifest.json','plugin.js','LICENSE','README.md']: archive.write(root/name,name)
print(output)
