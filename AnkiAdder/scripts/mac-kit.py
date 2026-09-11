"""Create a source/build kit with Unix permissions for the double-click Mac setup."""
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
output = root / 'release' / f'AnkiAdder-Mac-Build-Kit-{version}.zip'
output.parent.mkdir(exist_ok=True)
files = [root / p for p in ['package.json', 'package-lock.json', 'README.md', 'project_context.md', 'Build Mac App.command']]
for folder in ['src', 'scripts', 'test', '.github']:
    files.extend(p for p in (root / folder).rglob('*') if p.is_file())
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
    for file in sorted(files):
        info = ZipInfo('AnkiAdder/' + file.relative_to(root).as_posix())
        info.create_system = 3
        info.external_attr = (0o100755 if file.suffix == '.command' else 0o100644) << 16
        info.compress_type = ZIP_DEFLATED
        data = file.read_bytes()
        if file.suffix == '.command':
            data = data.replace(b'\r\n', b'\n')
        archive.writestr(info, data)
print(output)
