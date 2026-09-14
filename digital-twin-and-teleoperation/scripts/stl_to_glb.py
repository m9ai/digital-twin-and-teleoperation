#!/usr/bin/env python3
"""Batch-convert bare STL robot meshes into Draco-compressed GLB.

Why
---
URDF packages exported from CAD almost always ship raw ``.stl``:

* binary STL stores every triangle as 3 vertices + 1 normal (50 bytes/tri),
  with no indexed vertices and no transform hierarchy;
* the browser must fetch it whole and then rebuild index buffers on the main
  thread, which is what makes a 40 MB arm take ~10 s to appear;
* there is no material, so the viewer has to invent one.

``.glb`` (GLTF binary + Draco) is typically 8-15x smaller, carries an indexed
mesh plus PBR materials, and decodes in a worker. Converting offline is the
single highest-leverage optimisation for a Web digital twin.

Two engines are supported:

``trimesh`` (default, pure Python, no GUI required)::

    pip install -r scripts/requirements.txt
    python scripts/stl_to_glb.py meshes/ --out meshes_glb --draco

``blender`` (better re-meshing / normal handling for pathological exports)::

    python scripts/stl_to_glb.py meshes/ --out meshes_glb --engine blender \
        --blender /Applications/Blender.app/Contents/MacOS/Blender

Both modes can also rewrite the mesh references inside a URDF so the converted
package is drop-in ready::

    python scripts/stl_to_glb.py meshes/ --out meshes_glb --draco \
        --urdf robot.urdf --urdf-out robot_glb.urdf
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable

MESH_REF_RE = re.compile(r'(<mesh\s+filename\s*=\s*")([^"]+)(")', re.IGNORECASE)
STL_SUFFIXES = {'.stl'}
GLB_SUFFIXES = {'.glb', '.gltf'}


def iter_inputs(paths: Iterable[Path], recursive: bool) -> list[Path]:
    files: list[Path] = []
    for path in paths:
        if path.is_dir():
            pattern = '**/*' if recursive else '*'
            files.extend(
                p for p in path.glob(pattern)
                if p.is_file() and p.suffix.lower() in STL_SUFFIXES
            )
        elif path.is_file():
            if path.suffix.lower() in STL_SUFFIXES:
                files.append(path)
        else:
            print(f'[warn] skipped (not found): {path}', file=sys.stderr)
    return sorted(files)


def convert_with_trimesh(src: Path, dst: Path) -> None:
    try:
        import trimesh  # noqa: PLC0415  (imported lazily so --help works without deps)
    except ImportError:
        raise SystemExit(
            'trimesh is required for --engine trimesh.\n'
            '  pip install -r scripts/requirements.txt'
        )

    mesh = trimesh.load_mesh(str(src), force='mesh')

    # Raw STL often carries no vertex normals or degenerate faces; fix both
    # before exporting so PBR lighting does not look faceted.
    mesh.remove_degenerate_faces()
    mesh.remove_duplicate_faces()
    mesh.remove_unreferenced_vertices()
    mesh.merge_vertices()
    mesh.fix_normals()

    dst.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(str(dst), file_type='glb')


BLENDER_SCRIPT = '''
import bpy, sys
src, dst = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_mesh.stl(filepath=src)
objs = list(bpy.context.scene.objects)
for obj in objs:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_add(type='TRIANGULATE')
    bpy.ops.object.modifier_add(type='WELD')
    bpy.ops.object.modifier_apply(modifier=obj.modifiers[0].name)
    bpy.ops.object.modifier_apply(modifier=obj.modifiers[0].name)
    bpy.ops.object.shade_smooth()
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_apply=True)
'''


def convert_with_blender(src: Path, dst: Path, blender: str) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False) as handle:
        handle.write(BLENDER_SCRIPT)
        script_path = handle.name

    try:
        subprocess.run(
            [blender, '--background', '--python', script_path, '--', str(src), str(dst)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError:
        raise SystemExit(f'Blender executable not found: {blender}')
    finally:
        Path(script_path).unlink(missing_ok=True)


def compress_with_gltf_transform(src: Path, dst: Path, quantize: bool) -> bool:
    """Draco-compress a GLB using the official gltf-transform CLI via npx."""
    if shutil.which('npx') is None:
        print('[warn] npx not found; skipping Draco compression.', file=sys.stderr)
        return False

    command = [
        'npx', '--yes', '@gltf-transform/cli@^4', 'optimize', str(src), str(dst),
        '--compress', 'draco',
    ]
    if not quantize:
        command.append('--no-quantize')

    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        print(f'[warn] Draco compression failed for {src.name}:', file=sys.stderr)
        print(result.stderr.strip()[:800], file=sys.stderr)
        return False
    return True


def rewrite_urdf(urdf_path: Path, urdf_out: Path, converted: dict[str, str]) -> None:
    text = urdf_path.read_text(encoding='utf-8')

    def replace(match: re.Match[str]) -> str:
        raw = match.group(2)
        basename = Path(raw).name
        if basename.lower() in converted:
            directory = str(Path(raw).parent)
            new_name = converted[basename.lower()]
            new_ref = f'{directory}/{new_name}' if directory not in ('', '.') else new_name
            return f'{match.group(1)}{new_ref}{match.group(3)}'
        return match.group(0)

    urdf_out.write_text(MESH_REF_RE.sub(replace, text), encoding='utf-8')


def human(size: int) -> str:
    value = float(size)
    for unit in ('B', 'KB', 'MB', 'GB'):
        if value < 1024 or unit == 'GB':
            return f'{value:.1f} {unit}'
        value /= 1024
    return f'{value:.1f} GB'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('inputs', nargs='+', type=Path, help='STL files or directories')
    parser.add_argument('--out', type=Path, required=True, help='output directory for GLB files')
    parser.add_argument('--recursive', action='store_true', help='scan input directories recursively')
    parser.add_argument('--engine', choices=('trimesh', 'blender'), default='trimesh')
    parser.add_argument('--blender', default='blender', help='path to the Blender executable')
    parser.add_argument('--draco', action='store_true', help='apply Draco compression (needs npx)')
    parser.add_argument('--no-quantize', action='store_true', help='skip mesh quantization')
    parser.add_argument('--urdf', type=Path, help='URDF whose mesh references should be rewritten')
    parser.add_argument('--urdf-out', type=Path, help='destination for the rewritten URDF')
    parser.add_argument('--flatten', action='store_true', help='write all GLBs directly into --out')
    args = parser.parse_args()

    sources = iter_inputs(args.inputs, args.recursive)
    if not sources:
        print('No STL files found.', file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    converted: dict[str, str] = {}
    total_in = total_out = 0

    for index, src in enumerate(sources, start=1):
        relative = src.name if args.flatten else src.relative_to(src.parents[len(src.parents) - 1])
        target = args.out / Path(relative).with_suffix('.glb')
        target.parent.mkdir(parents=True, exist_ok=True)

        print(f'[{index}/{len(sources)}] {src.name}')

        if args.engine == 'blender':
            convert_with_blender(src, target, args.blender)
        else:
            convert_with_trimesh(src, target)

        if args.draco:
            compressed = target.with_name(f'{target.stem}.drc{target.suffix}')
            if compress_with_gltf_transform(target, compressed, not args.no_quantize):
                target.unlink(missing_ok=True)
                compressed.rename(target)

        size_in = src.stat().st_size
        size_out = target.stat().st_size if target.exists() else 0
        total_in += size_in
        total_out += size_out
        ratio = size_in / size_out if size_out else 0
        print(f'    {human(size_in)} -> {human(size_out)}  ({ratio:.1f}x smaller)')

        converted[src.name.lower()] = target.name

    print(f'\nTotal: {human(total_in)} -> {human(total_out)}')

    if args.urdf:
        urdf_out = args.urdf_out or args.urdf.with_name(f'{args.urdf.stem}_glb{args.urdf.suffix}')
        rewrite_urdf(args.urdf, urdf_out, converted)
        print(f'URDF rewritten: {urdf_out}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
