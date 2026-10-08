from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1]
source=Path('C:/Users/nojae/.codex/generated_images/01a0d9ea-7d3e-7f33-8e65-3818ee74d1fe/exec-fcccc528-d250-4acb-b8df-8874053fab42.png')
image=Image.open(source).convert('RGBA')
image.save(root/'assets/Omics.png')
image.save(root/'assets/Omics.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('Converted the clean generated artwork to PNG and multi-resolution ICO.')
