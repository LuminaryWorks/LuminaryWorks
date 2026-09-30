#!/bin/sh
# Build a short clear HLS and a short encrypted HLS with Docker ffmpeg.
# The AES key file is removed before this script returns.
set -eu
out=${1:?output directory}
key_hex=${2:?32 hex chars}
image=${FFMPEG_IMAGE:-jrottenberg/ffmpeg:7.1-alpine}

rm -rf "$out"
mkdir -p "$out/clear" "$out/enc"
python3 -c 'import pathlib,sys; pathlib.Path(sys.argv[1]).write_bytes(bytes.fromhex(sys.argv[2]))' "$out/enc/enc.key" "$key_hex"
printf '%s\n%s\n' "https://gateway.invalid/key" "/work/enc/enc.key" > "$out/enc/enc.keyinfo"

encode() {
  docker run --rm --entrypoint ffmpeg \
    -v "$out:/work" \
    "$image" \
    -y \
    -f lavfi -i "testsrc=duration=4:size=320x180:rate=15" \
    -f lavfi -i "sine=frequency=440:duration=4:sample_rate=44100" \
    -shortest -map 0:v:0 -map 1:a:0 \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p \
    -c:a aac -ac 2 -b:a 96k \
    "$@"
}

encode \
  -hls_time 2 -hls_playlist_type vod \
  -hls_segment_filename /work/clear/seg-%04d.ts \
  /work/clear/index.m3u8

encode \
  -hls_time 2 -hls_playlist_type vod \
  -hls_key_info_file /work/enc/enc.keyinfo \
  -hls_segment_filename /work/enc/seg-%04d.ts \
  /work/enc/index.m3u8

rm -f "$out/enc/enc.key" "$out/enc/enc.keyinfo"
test -s "$out/enc/index.m3u8"
test -s "$out/clear/index.m3u8"
