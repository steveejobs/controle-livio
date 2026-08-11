#!/usr/bin/env python3
"""Otimiza imagens raster sem sobrescrever os arquivos de origem."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Final

from PIL import Image, ImageOps, UnidentifiedImageError

SUPPORTED_SUFFIXES: Final = {".jpg", ".jpeg", ".png", ".webp"}
OUTPUT_SUFFIXES: Final = {"jpeg": ".jpg", "png": ".png", "webp": ".webp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Otimiza JPEG, PNG e WebP em uma pasta de saída separada."
    )
    parser.add_argument("input", type=Path, help="Arquivo ou diretório de origem")
    parser.add_argument("--output", type=Path, required=True, help="Diretório de destino")
    parser.add_argument(
        "--format", choices=("keep", "jpeg", "png", "webp"), default="keep"
    )
    parser.add_argument("--quality", type=int, default=82, help="Qualidade JPEG/WebP (1–95)")
    parser.add_argument("--max-width", type=int, help="Redimensiona apenas imagens mais largas")
    parser.add_argument("--keep-metadata", action="store_true", help="Preserva EXIF quando possível")
    return parser.parse_args()


def source_files(source: Path) -> list[Path]:
    if source.is_file():
        return [source] if source.suffix.lower() in SUPPORTED_SUFFIXES else []
    return sorted(
        path
        for path in source.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
    )


def output_path(source: Path, root: Path, output: Path, output_format: str) -> Path:
    relative = Path(source.name) if root.is_file() else source.relative_to(root)
    target = output / relative
    if output_format != "keep":
        target = target.with_suffix(OUTPUT_SUFFIXES[output_format])
    return target


def resized(image: Image.Image, max_width: int | None) -> Image.Image:
    if max_width is None or image.width <= max_width:
        return image
    height = max(1, round(image.height * max_width / image.width))
    return image.resize((max_width, height), Image.Resampling.LANCZOS)


def optimize(source: Path, target: Path, output_format: str, quality: int, keep_metadata: bool, max_width: int | None) -> tuple[int, int]:
    with Image.open(source) as opened:
        opened.verify()
    with Image.open(source) as opened:
        image = resized(ImageOps.exif_transpose(opened), max_width)
        actual_format = (opened.format or source.suffix.removeprefix(".")).upper()
        save_format = actual_format if output_format == "keep" else output_format.upper()
        if save_format == "JPG":
            save_format = "JPEG"
        if save_format == "JPEG" and image.mode not in ("RGB", "L"):
            background = Image.new("RGB", image.size, "white")
            if "A" in image.getbands():
                background.paste(image, mask=image.getchannel("A"))
            else:
                background.paste(image.convert("RGB"))
            image = background

        target.parent.mkdir(parents=True, exist_ok=True)
        options: dict[str, object] = {"optimize": True}
        if save_format in {"JPEG", "WEBP"}:
            options["quality"] = quality
        if keep_metadata and opened.info.get("exif"):
            options["exif"] = opened.info["exif"]
        image.save(target, format=save_format, **options)
    return source.stat().st_size, target.stat().st_size


def main() -> int:
    args = parse_args()
    source = args.input.resolve()
    output = args.output.resolve()
    if not source.exists():
        print("Origem não encontrada.", file=sys.stderr)
        return 2
    if source == output or (source.is_dir() and output.is_relative_to(source)):
        print("A saída deve ficar fora da origem para preservar os arquivos.", file=sys.stderr)
        return 2
    if not 1 <= args.quality <= 95:
        print("A qualidade deve estar entre 1 e 95.", file=sys.stderr)
        return 2
    if args.max_width is not None and args.max_width < 1:
        print("A largura máxima deve ser positiva.", file=sys.stderr)
        return 2

    files = source_files(source)
    if not files:
        print("Nenhuma imagem compatível encontrada.")
        return 0

    before = after = failures = 0
    for image_file in files:
        target = output_path(image_file, source, output, args.format)
        try:
            original_size, optimized_size = optimize(
                image_file, target, args.format, args.quality, args.keep_metadata, args.max_width
            )
            before += original_size
            after += optimized_size
            print(f"OK {image_file} -> {target}")
        except (OSError, UnidentifiedImageError, ValueError) as error:
            failures += 1
            print(f"ERRO {image_file}: {error}", file=sys.stderr)

    reduction = 0 if before == 0 else (1 - after / before) * 100
    print(f"Processadas: {len(files) - failures}; falhas: {failures}; redução: {reduction:.1f}%")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
