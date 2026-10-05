"""音声ガイドの生成.

Microsoft のニューラル音声（Edge の読み上げエンジン）で合成し、
端末互換性のため 44.1kHz / MPEG-1 Layer III の MP3 に変換する。

    pip install edge-tts
    python tools/gen-voice.py

生成時だけネットワークが必要。出力は静的ファイルなので、アプリ実行時に
外部通信は発生しない。ffmpeg が PATH にあること。

注意:
  - 24kHz は MPEG-2 拡張にあたり、デコーダによって再生されない端末が
    あるため必ず 44.1kHz に変換する。
  - 先頭に 20ms の余白を入れる。エンコーダ遅延で語頭が欠けるのを防ぐ。
  - 各音声は対応フェーズの最短長より短くなければならない。超えると
    次の案内に切られる。生成後に検証して警告を出す。
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(HERE, "build")
OUT = os.path.join(ROOT, "audio")

# 落ち着いた誘導にしたいので既定よりゆっくり話させる。
VOICES = {
    "ja": {"voice": "ja-JP-NanamiNeural", "rate": "-12%"},
    "en": {"voice": "en-US-JennyNeural", "rate": "-10%"},
}

# 各クリップが収まらなければならない最短フェーズ長（秒）
LIMITS = {
    "inhale-left": 4, "inhale-right": 4, "hold": 8,
    "exhale-left": 8, "exhale-right": 8,
    "prep-inhale": 3, "prep-exhale": 6,
}

TRIM = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,"
        "areverse,"
        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,"
        "areverse")


async def synth(text, voice, rate, dest):
    import edge_tts
    await edge_tts.Communicate(text, voice, rate=rate).save(dest)


def encode(src, dest):
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", src,
        "-af", TRIM + ",adelay=20,loudnorm=I=-18:TP=-2.0:LRA=7,aresample=44100",
        "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", dest,
    ], check=True)


def duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path],
        capture_output=True, text=True).stdout.strip()
    return float(out) if out else 0.0


async def main():
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg が見つかりません")

    with open(os.path.join(HERE, "voice-phrases.json"), encoding="utf-8") as f:
        phrases = json.load(f)

    problems = []
    for lang, items in phrases.items():
        cfg = VOICES[lang]
        os.makedirs(os.path.join(RAW, lang), exist_ok=True)
        os.makedirs(os.path.join(OUT, lang), exist_ok=True)

        for name, text in items.items():
            raw = os.path.join(RAW, lang, name + ".mp3")
            dest = os.path.join(OUT, lang, name + ".mp3")
            await synth(text, cfg["voice"], cfg["rate"], raw)
            encode(raw, dest)

            d = duration(dest)
            limit = LIMITS.get(name)
            mark = ""
            if limit and d >= limit:
                mark = "  ← %ss のフェーズに収まらない" % limit
                problems.append("%s/%s (%.2fs >= %ss)" % (lang, name, d, limit))
            print("  %-3s %-14s %5.2fs  %s%s" % (lang, name, d, text, mark))

    if problems:
        print("\n収まらないクリップがあります:")
        for p in problems:
            print("  " + p)
        sys.exit(1)
    print("\n完了")


if __name__ == "__main__":
    asyncio.run(main())
