#!/usr/bin/env bash
# Builds "The Line on the Wall" from source.
#   1. HyperFrames renders the river scenes and the closing.
#   2. Motion Canvas renders the engine scene (its editor must be running: cd motion-canvas && npm run editor).
#   3. Remotion generates the score, assembles everything and renders the film, the loop and the poster.
# The UI screens in film/public/ui come from scenario/ (see scenario/setup.sh).
set -euo pipefail
cd "$(dirname "$0")"
export HYPERFRAMES_SKIP_SKILLS=1 DO_NOT_TRACK=1

mkdir -p film/public/clips hyperframes/renders motion-canvas/renders
for scene in opening rise closing; do
  (cd hyperframes && npx -y hyperframes@0.8.98 render -c "compositions/$scene.html" -o "renders/$scene.mp4")
  cp "hyperframes/renders/$scene.mp4" film/public/clips/
done

(cd motion-canvas && rm -rf output && node render.mjs 600)
ffmpeg -v error -y -framerate 30 -i motion-canvas/output/engine/%06d.png -c:v libx264 -pix_fmt yuv420p -crf 16 motion-canvas/renders/engine.mp4
cp motion-canvas/renders/engine.mp4 film/public/clips/

cd film
npm run audio
npm run render
# Loudness for the web: -20 LUFS integrated, -2 dB true peak, remuxed without re-rendering the picture.
ffmpeg -v error -y -i public/audio/score.wav -af loudnorm=I=-20:TP=-2:LRA=11 -ar 48000 renders/score-norm.wav
ffmpeg -v error -y -i renders/film.mp4 -i renders/score-norm.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 160k -shortest -movflags +faststart renders/film-final.mp4
ffmpeg -v error -y -i renders/film-final.mp4 -vf scale=1280:720:flags=lanczos -c:v libx264 -crf 24 -preset slow -pix_fmt yuv420p -c:a copy -movflags +faststart renders/film-720p.mp4
npm run loop
ffmpeg -v error -y -i renders/loop.mp4 -vf scale=1280:720:flags=lanczos -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -an -movflags +faststart renders/loop-720p.mp4
npm run poster
# The README's inline preview: GitHub plays GIFs but not repository videos.
ffmpeg -v error -y -i renders/loop.mp4 -vf "fps=15,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle" ../../docs/media/the-line-on-the-wall.gif

cp renders/film-final.mp4 ../../public/demo/the-line-on-the-wall.mp4
cp renders/film-720p.mp4 ../../public/demo/the-line-on-the-wall-720p.mp4
cp renders/loop-720p.mp4 ../../public/demo/the-line-on-the-wall-loop.mp4
cp renders/poster.png ../../public/demo/the-line-on-the-wall.png
cp captions.vtt ../../public/demo/the-line-on-the-wall.vtt
echo "Published to public/demo/the-line-on-the-wall*"
