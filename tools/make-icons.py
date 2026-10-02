import struct
import sys
import zlib

SRC = r'D:\phanmem\Copanel\copanel.png'
TARGETS = [
    (r'D:\phanmem\Copanel\public\icon.png', 256),
    (r'D:\phanmem\Copanel\public\favicon.png', 64),
]


def decode_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', 'not a png'
    pos, idat, ihdr = 8, b'', None
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos + 4])[0]
        typ = d[pos + 4:pos + 8]
        data = d[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            ihdr = struct.unpack('>IIBBBBB', data)
        elif typ == b'IDAT':
            idat += data
        pos += 12 + ln
    w, h, bd, ct, _comp, _filt, inter = ihdr
    assert bd == 8 and ct == 6 and inter == 0, 'expected 8-bit RGBA, non-interlaced'
    bpp, stride = 4, w * 4
    raw = zlib.decompress(idat)
    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    off = 0
    for y in range(h):
        f = raw[off]
        line = bytearray(raw[off + 1:off + 1 + stride])
        off += 1 + stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, out


def weights(dst, src):
    ratio = src / dst
    table = []
    for i in range(dst):
        lo, hi = i * ratio, (i + 1) * ratio
        start, end = int(lo), min(int(hi - 1e-9), src - 1)
        pairs = []
        total = 0.0
        for s in range(start, end + 1):
            span = min(hi, s + 1) - max(lo, s)
            if span > 0:
                pairs.append((s, span))
                total += span
        table.append([(s, w / total) for s, w in pairs])
    return table


def resize(sw, sh, src_rgba, dw, dh):
    prem = [0.0] * (sw * sh * 4)
    for i in range(sw * sh):
        a = src_rgba[i * 4 + 3] / 255.0
        prem[i * 4] = src_rgba[i * 4] * a
        prem[i * 4 + 1] = src_rgba[i * 4 + 1] * a
        prem[i * 4 + 2] = src_rgba[i * 4 + 2] * a
        prem[i * 4 + 3] = a

    wx = weights(dw, sw)
    tmp = [0.0] * (dw * sh * 4)
    for y in range(sh):
        row = y * sw * 4
        outrow = y * dw * 4
        for x in range(dw):
            r = g = b = a = 0.0
            for sx, w in wx[x]:
                base = row + sx * 4
                r += prem[base] * w
                g += prem[base + 1] * w
                b += prem[base + 2] * w
                a += prem[base + 3] * w
            o = outrow + x * 4
            tmp[o], tmp[o + 1], tmp[o + 2], tmp[o + 3] = r, g, b, a

    wy = weights(dh, sh)
    out = bytearray(dw * dh * 4)
    for y in range(dh):
        for x in range(dw):
            r = g = b = a = 0.0
            for sy, w in wy[y]:
                base = (sy * dw + x) * 4
                r += tmp[base] * w
                g += tmp[base + 1] * w
                b += tmp[base + 2] * w
                a += tmp[base + 3] * w
            o = (y * dw + x) * 4
            if a > 0:
                out[o] = min(255, int(r / a + 0.5))
                out[o + 1] = min(255, int(g / a + 0.5))
                out[o + 2] = min(255, int(b / a + 0.5))
                out[o + 3] = min(255, int(a * 255 + 0.5))
            else:
                out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0
    return out


def write_png(path, w, h, rgba):
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))
    raw = b''.join(b'\x00' + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)


def main():
    sw, sh, rgba = decode_png(SRC)
    print('source', sw, sh)
    for path, size in TARGETS:
        data = resize(sw, sh, rgba, size, size)
        write_png(path, size, size, data)
        print('wrote', path, size, 'x', size)


if __name__ == '__main__':
    sys.exit(main())
