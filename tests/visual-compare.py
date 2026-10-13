"""Compare matching screenshots at 1440x1000; keep the 0.5% gate and explicit dynamic-only masks."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('--directory', type=Path, required=True)
parser.add_argument('--manifest', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
manifest = json.loads(args.manifest.read_text())
results = []
for item in manifest['screens']:
    before = Image.open(args.directory / item['baseline']).convert('RGB')
    after = Image.open(args.directory / item['actual']).convert('RGB')
    if before.size != (1440, 1000) or after.size != before.size:
        raise ValueError('All compared screens must be original 1440x1000 captures')
    usable = Image.new('L', before.size, 255)
    for mask in item.get('masks', []):
        if mask['kind'] not in {'id', 'time', 'duration'}: raise ValueError('Only dynamic IDs, timestamps and durations may be masked')
        x, y, width, height = mask['rect']
        ImageDraw.Draw(usable).rectangle((x,y,x+width-1,y+height-1),fill=0)
    # Ignore only tiny JPEG/anti-alias differences, never layout, text, or broad areas.
    channels = ImageChops.difference(before, after).split()
    difference = ImageChops.lighter(ImageChops.lighter(channels[0],channels[1]),channels[2])
    changed = ImageChops.multiply(difference.point(lambda value: 255 if value > 16 else 0), usable)
    changed_pixels = changed.histogram()[255]
    compared_pixels = usable.histogram()[255]
    ratio = changed_pixels / compared_pixels
    heat = Image.composite(Image.new('RGB',after.size,(188,77,70)),after,changed)
    file = args.output.parent / (item['id']+'-difference.png')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    heat.save(file)
    results.append({'id': item['id'], 'ratio': ratio, 'threshold': 0.005, 'passed': ratio <= 0.005,
                    'changed_pixels': changed_pixels, 'compared_pixels': compared_pixels, 'difference': str(file)})
args.output.write_text(json.dumps({'method':'RGB max-channel difference >16, dynamic-only masks',
    'screens':results,'passed':all(r['passed'] for r in results)},ensure_ascii=False,indent=2)+'\n')
print(json.dumps([{'id':r['id'],'difference_percent':round(r['ratio']*100,3),'passed':r['passed']} for r in results],ensure_ascii=False,indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
