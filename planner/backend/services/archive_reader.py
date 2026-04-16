"""
Minimal ZIP archive reader that handles the compression methods used by DCS
kneeboard mod packages (.ozp), including method 93 (Zstandard) which Python's
standard ``zipfile`` module does not decompress.

Supported compression methods:
    0  — stored (no compression)
    8  — deflate (standard zlib)
    14 — LZMA (via Python stdlib `lzma`)
    93 — Zstandard (via `zstandard` package)

Falls back to Python's built-in ``zipfile`` first; if that raises due to an
unknown compression method, we do a manual central-directory scan and
decompress each entry explicitly.
"""

from __future__ import annotations

import io
import struct
import zipfile
import zlib
from dataclasses import dataclass
from typing import Iterator

# -- End-of-central-directory record signature & size
_EOCD_SIG = b"PK\x05\x06"
_EOCD_MIN_SIZE = 22
_EOCD_MAX_COMMENT = 0xFFFF

# Zip64 EOCD
_EOCD64_SIG = b"PK\x06\x06"
_EOCD64_LOCATOR_SIG = b"PK\x06\x07"

# Central directory record
_CDIR_SIG = b"PK\x01\x02"
_CDIR_HEADER_FMT = "<4s4B4HL2L5H2L"
_CDIR_HEADER_SIZE = struct.calcsize(_CDIR_HEADER_FMT)

# Local file header
_LOCAL_SIG = b"PK\x03\x04"
_LOCAL_HEADER_FMT = "<4s2B4HL2L2H"
_LOCAL_HEADER_SIZE = struct.calcsize(_LOCAL_HEADER_FMT)


@dataclass
class ArchiveEntry:
    filename: str
    is_dir: bool
    compressed_size: int
    uncompressed_size: int
    compress_type: int
    local_header_offset: int


def _find_eocd(data: bytes) -> int:
    """Find the end-of-central-directory offset in the ZIP bytes."""
    max_search = min(len(data), _EOCD_MIN_SIZE + _EOCD_MAX_COMMENT)
    # Search backwards for the signature
    tail = data[-max_search:]
    idx = tail.rfind(_EOCD_SIG)
    if idx < 0:
        raise ValueError("ZIP end-of-central-directory record not found")
    return len(data) - max_search + idx


def _iter_central_directory(data: bytes) -> Iterator[ArchiveEntry]:
    eocd_offset = _find_eocd(data)
    (
        _sig, _disk, _disk_start, _num_disk, _num_total,
        cdir_size, cdir_offset, _comment_len,
    ) = struct.unpack("<4s4H2LH", data[eocd_offset:eocd_offset + _EOCD_MIN_SIZE])

    # If ZIP64 is used the 32-bit fields are all 0xFFFFFFFF / 0xFFFF sentinels.
    if cdir_offset == 0xFFFFFFFF or cdir_size == 0xFFFFFFFF:
        # Look for ZIP64 end-of-central-directory locator right before the EOCD
        locator_offset = eocd_offset - 20
        if locator_offset > 0 and data[locator_offset:locator_offset + 4] == _EOCD64_LOCATOR_SIG:
            (_l_sig, _disk_num, zip64_eocd_offset, _total_disks) = struct.unpack(
                "<4sLQL", data[locator_offset:locator_offset + 20]
            )
            # Parse ZIP64 EOCD
            if data[zip64_eocd_offset:zip64_eocd_offset + 4] == _EOCD64_SIG:
                (
                    _sig, _size, _ver_made, _ver_needed, _disk, _disk_cd,
                    _num_disk, _num_total, cdir_size, cdir_offset,
                ) = struct.unpack(
                    "<4sQ2H2L4Q",
                    data[zip64_eocd_offset:zip64_eocd_offset + 56],
                )

    # Walk central directory records
    pos = cdir_offset
    end = cdir_offset + cdir_size
    while pos < end:
        if data[pos:pos + 4] != _CDIR_SIG:
            break
        hdr = data[pos:pos + _CDIR_HEADER_SIZE]
        (
            _sig, _ver_made, _made_os, _ver_needed, _needed_os,
            _flags, compress_type, _mod_time, _mod_date,
            _crc, compressed_size, uncompressed_size,
            fname_len, extra_len, comment_len,
            _disk_start, _int_attrs, _ext_attrs,
            local_offset,
        ) = struct.unpack(_CDIR_HEADER_FMT, hdr)

        fname_start = pos + _CDIR_HEADER_SIZE
        filename = data[fname_start:fname_start + fname_len].decode("utf-8", errors="replace")

        # ZIP64 extra field handling (needed when any size or offset is 0xFFFFFFFF)
        if (
            compressed_size == 0xFFFFFFFF or uncompressed_size == 0xFFFFFFFF
            or local_offset == 0xFFFFFFFF
        ):
            extra = data[fname_start + fname_len:fname_start + fname_len + extra_len]
            i = 0
            while i + 4 <= len(extra):
                tag, sz = struct.unpack("<HH", extra[i:i + 4])
                if tag == 0x0001:  # ZIP64 extended info
                    vals_pos = i + 4
                    if uncompressed_size == 0xFFFFFFFF:
                        uncompressed_size = struct.unpack("<Q", extra[vals_pos:vals_pos + 8])[0]
                        vals_pos += 8
                    if compressed_size == 0xFFFFFFFF:
                        compressed_size = struct.unpack("<Q", extra[vals_pos:vals_pos + 8])[0]
                        vals_pos += 8
                    if local_offset == 0xFFFFFFFF:
                        local_offset = struct.unpack("<Q", extra[vals_pos:vals_pos + 8])[0]
                    break
                i += 4 + sz

        yield ArchiveEntry(
            filename=filename,
            is_dir=filename.endswith("/"),
            compressed_size=compressed_size,
            uncompressed_size=uncompressed_size,
            compress_type=compress_type,
            local_header_offset=local_offset,
        )

        pos += _CDIR_HEADER_SIZE + fname_len + extra_len + comment_len


def _decompress(data: bytes, method: int, expected_size: int) -> bytes:
    if method == 0:  # stored
        return data
    if method == 8:  # deflate
        return zlib.decompress(data, -zlib.MAX_WBITS)
    if method == 14:  # LZMA
        import lzma
        return lzma.decompress(data)
    if method == 93:  # Zstandard
        import zstandard
        dctx = zstandard.ZstdDecompressor()
        # Some producers pack zstd frames inside ZIP with/without frame size;
        # use stream reader to tolerate both.
        return dctx.decompress(data, max_output_size=max(expected_size, 1))
    raise NotImplementedError(f"Unsupported compression method: {method}")


def _read_entry(data: bytes, entry: ArchiveEntry) -> bytes:
    # Local file header gives us the actual offset to compressed bytes
    lh_start = entry.local_header_offset
    lh = data[lh_start:lh_start + _LOCAL_HEADER_SIZE]
    (
        _sig, _ver_needed, _needed_os, _flags, _method, _mtime, _mdate,
        _crc, _csize, _usize, fname_len, extra_len,
    ) = struct.unpack(_LOCAL_HEADER_FMT, lh)
    data_start = lh_start + _LOCAL_HEADER_SIZE + fname_len + extra_len
    compressed = data[data_start:data_start + entry.compressed_size]
    return _decompress(compressed, entry.compress_type, entry.uncompressed_size)


def read_archive(data: bytes) -> list[tuple[str, bytes]]:
    """Read a ZIP archive and return [(filename, bytes), ...] for non-dir entries.

    Tries Python's built-in zipfile first (fastest & handles most cases). Falls
    back to manual parsing with explicit decompressors for method 93 (zstd)
    which stdlib doesn't handle.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            out: list[tuple[str, bytes]] = []
            for info in zf.infolist():
                if info.is_dir():
                    continue
                out.append((info.filename, zf.read(info.filename)))
            return out
    except (NotImplementedError, RuntimeError, zipfile.BadZipFile):
        pass  # Fall through to manual parse

    # Manual central-directory walk
    out = []
    for entry in _iter_central_directory(data):
        if entry.is_dir:
            continue
        try:
            body = _read_entry(data, entry)
        except NotImplementedError as e:
            raise NotImplementedError(
                f"Unsupported compression method {entry.compress_type} for "
                f"{entry.filename}"
            ) from e
        out.append((entry.filename, body))
    return out
