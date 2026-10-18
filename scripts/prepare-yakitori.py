"""Offline conversion of the owner-supplied Yakitori source; never publishes it.

Run with an official Blender 4.5+ binary:
  blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
    --python scripts/prepare-yakitori.py -- \
    /path/yakitori_free_momo.blend /path/textures.zip

Outputs stay in ignored .local-assets/yakitori. No source scripts are executed,
no original is saved, and the author's metre scale is preserved (not certified).
"""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import tempfile
from zipfile import ZipFile

import bpy
from mathutils import Matrix, Vector


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("blend", type=Path)
    parser.add_argument("textures", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    root = Path(__file__).resolve().parents[1]
    output = root / ".local-assets" / "yakitori"
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise RuntimeError("Output already exists. Move the previous review aside before converting again.")

    with tempfile.TemporaryDirectory(prefix="restaurant-os-yakitori-") as temp:
        folder = Path(temp)
        with ZipFile(args.textures) as archive:
            entries = archive.infolist()
            if len(entries) > 20 or sum(e.file_size for e in entries) > 50_000_000:
                raise ValueError("Unexpectedly large texture package.")
            names = set()
            for entry in entries:
                name = PurePosixPath(entry.filename)
                if name.is_absolute() or ".." in name.parts or "\\" in entry.filename or entry.flag_bits & 1:
                    raise ValueError("Unsafe texture package path.")
                if entry.is_dir():
                    continue
                if name.suffix.lower() != ".png" or name.name in names:
                    raise ValueError("Expected uniquely named PNG textures.")
                names.add(name.name)
                (folder / name.name).write_bytes(archive.read(entry))

        # Source files may contain Python text/driver data. Explicitly disable it.
        bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()), load_ui=False, use_scripts=False)
        scene = bpy.context.scene
        if scene.unit_settings.system != "METRIC" or scene.unit_settings.scale_length != 1:
            raise ValueError("Source units changed; a human must review its physical scale.")
        objects = [o for o in scene.objects if o.type == "MESH"]
        if sorted(o.name for o in objects) != sorted(["plate", "02_Thigh_meat"] + [f"02_Thigh_meat.{i:03d}" for i in range(1, 5)]):
            raise ValueError("This recipe only supports the original five-skewer Yakitori scene.")

        # Relink only textures used by the six exported meshes. Other source
        # datablocks refer to unrelated dishes and must never enter this model.
        used_materials = {m for o in objects for m in o.data.materials if m}
        used_images = set()
        material_report = []
        for material in used_materials:
            if not material.use_nodes:
                raise ValueError("Expected textured Principled materials.")
            principled = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            material_report.append({"name": material.name, "roughness": principled.inputs['Roughness'].default_value, "metallic": principled.inputs['Metallic'].default_value})
            # Standard core PBR export; do not add glTF transmission/specular
            # extensions that the application's deliberately narrow gateway denies.
            for name, value in [("Transmission Weight", 0), ("Coat Weight", 0), ("Sheen Weight", 0), ("Specular IOR Level", 0.5), ("IOR", 1.5)]:
                if name in principled.inputs:
                    principled.inputs[name].default_value = value
            for node in material.node_tree.nodes:
                if node.type != "TEX_IMAGE" or not node.image:
                    continue
                filename = Path(node.image.filepath).name
                source = folder / filename
                if not source.is_file():
                    raise ValueError(f"Missing required texture: {filename}")
                node.image.filepath = str(source)
                node.image.reload()
                if tuple(node.image.size) != (1024, 1024):
                    raise ValueError("Unexpected source texture dimensions.")
                node.image.colorspace_settings.name = "sRGB" if "albedo" in filename else "Non-Color"
                used_images.add(filename)

        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.hide_set(False)
            obj.hide_viewport = False
            obj.select_set(True)
        bpy.context.view_layer.objects.active = next(o for o in objects if o.name == "plate")
        # Apply actual evaluated geometry, preserving source presentation.
        for obj in objects:
            bpy.context.view_layer.objects.active = obj
            for modifier in list(obj.modifiers):
                bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.context.view_layer.objects.active = next(o for o in objects if o.name == "plate")
        bpy.ops.object.join()
        dish = bpy.context.object
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        low = [min(v.co[k] for v in dish.data.vertices) for k in range(3)]
        high = [max(v.co[k] for v in dish.data.vertices) for k in range(3)]
        offset = Vector((-(low[0]+high[0])/2, -(low[1]+high[1])/2, -low[2]))
        dish.data.transform(Matrix.Translation(offset))
        dish.name = "Yakitori Momo — source scale, not portion verified"
        dish.data.update()
        triangulate = dish.modifiers.new("Portable normal-map tangents", "TRIANGULATE")
        triangulate.keep_custom_normals = True
        bpy.ops.object.modifier_apply(modifier=triangulate.name)

        # glTF's +Y-up export rotates geometry, not a root transform. The
        # application independently verifies baked bounds and a Y=0 base.
        model = output / "yakitori-momo.glb"
        bpy.ops.export_scene.gltf(
            filepath=str(model), export_format="GLB", use_selection=True,
            export_yup=True, export_apply=True, export_tangents=True, export_animations=False,
            export_skins=False, export_morph=False, export_cameras=False,
            export_lights=False, export_extras=False, export_image_format="AUTO",
            export_draco_mesh_compression_enable=False,
        )
        report = {
            "source": "https://www.cgtrader.com/free-3d-models/food/miscellaneous/yakitori-free",
            "author": "Oshinchan", "sourceModelId": "5890465",
            "license": "CGTrader Royalty Free License (no AI); author prohibits redistribution/resale. Web delivery permission requires review.",
            "publicationApproved": False, "physicalScaleVerified": False, "arEnabled": False,
            "sourceBlendSHA256": digest(args.blend), "sourceTexturesSHA256": digest(args.textures),
            "blenderVersion": bpy.app.version_string,
            "sourceDimensionsMetresXYZ": [high[k]-low[k] for k in range(3)],
            "dimensionsMetresWidthHeightDepth": [high[0]-low[0], high[2]-low[2], high[1]-low[1]],
            "uniformScaleApplied": 1,
            "sourceMaterials": sorted(material_report, key=lambda m: m['name']),
            "textures": sorted(used_images), "textureMaxPixels": 1024,
            "modifications": "Relinked source textures; baked transforms/modifiers; centred horizontally and grounded base; triangulated with preserved normals and explicit tangents; exported static embedded GLB. Preserved authored metre size, without claiming actual dish measurements. Standard core PBR materials.",
            "rawGlbSHA256": digest(model), "rawGlbBytes": model.stat().st_size,
        }
        (output / "source-report.json").write_text(json.dumps(report, indent=2) + "\n")

        # Render a local review poster using the same converted geometry.
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 48
        scene.cycles.use_denoising = True
        scene.render.resolution_x, scene.render.resolution_y = 1200, 900
        scene.render.resolution_percentage = 100
        scene.view_settings.view_transform = "AgX"
        scene.world.use_nodes = True
        scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.78, 0.77, 0.72, 1)
        scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.45
        size = max(high[k]-low[k] for k in range(3))
        bpy.ops.mesh.primitive_plane_add(size=size*200, location=(0, 0, -0.0002))
        floor = bpy.context.object
        mat = bpy.data.materials.new("Local review background")
        mat.diffuse_color = (0.84, 0.82, 0.76, 1)
        floor.data.materials.append(mat)
        for position, energy, area_size in [((-0.2, -0.18, 0.35), 12, 0.3), ((0.2, 0.12, 0.25), 6, 0.25)]:
            lamp = bpy.data.lights.new("Review softbox", "AREA")
            lamp.energy, lamp.size = energy, area_size
            obj = bpy.data.objects.new(lamp.name, lamp)
            scene.collection.objects.link(obj)
            obj.location = position
            obj.rotation_euler = (Vector((0, 0, 0.01)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
        camera = bpy.data.cameras.new("Review camera")
        obj = bpy.data.objects.new(camera.name, camera)
        scene.collection.objects.link(obj)
        obj.location = (size*0.9, -size*1.5, size*1.5)
        obj.rotation_euler = (Vector((0, 0, 0.008)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
        camera.type, camera.ortho_scale = "ORTHO", size*1.65
        scene.camera = obj
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = str(output / "yakitori-poster.png")
        bpy.ops.render.render(write_still=True)
        print("Prepared local, unpublished Yakitori GLB and poster:", output)


if __name__ == "__main__":
    main()
