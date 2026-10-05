"""音声ガイドの生成.

Microsoft のニューラル音声（Edge の読み上げエンジン）で合成し、
端末互換性のため 44.1kHz / MPEG-1 Layer III の MP3 に変換する。

    pip install edge-tts
    python tools/gen-voice.py            # 全種類
    python tools/gen-voice.py warm male  # 指定した種類だけ

生成時だけネットワークが必要。出力は静的ファイルなので、アプリ実行時に
外部通信は発生しない。ffmpeg が PATH にあること。

出力: audio/<種類>/<言語>/<名前>.mp3

注意:
  - 24kHz は MPEG-2 拡張にあたり、デコーダによって再生されない端末が
    あるため必ず 44.1kHz に変換する。
  - 先頭に 20ms の余白を入れる。エンコーダ遅延で語頭が欠けるのを防ぐ。
  - 各音声は対応フェーズの最短長より短くなければならない。超えると
    次の案内に切られる。生成後に検証し、収まらなければ失敗する。
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

# 落ち着いたトーンは音程と速度だけでは作りきれない。合成音声は子音の
# 擦れる高音域が耳に刺さりやすく、それが緊張感の正体になりやすいので、
# 高域を下げて低域を足し、耳あたりを柔らかくしている。
VARIANTS = {
    "warm": {
        "voices": {"ja": "ja-JP-NanamiNeural", "en": "en-US-JennyNeural"},
        "rate": "-20%", "pitch": "-10Hz",
        "post": "highshelf=f=3200:g=-5,equalizer=f=220:t=q:w=1.2:g=2.5",
    },
    # warm にごく薄い残響を足し、広い場所で聴いているような奥行きを出す。
    "space": {
        "voices": {"ja": "ja-JP-NanamiNeural", "en": "en-US-JennyNeural"},
        "rate": "-20%", "pitch": "-10Hz",
        "post": ("highshelf=f=3200:g=-5,equalizer=f=220:t=q:w=1.2:g=2.5,"
                 "aecho=0.9:0.82:38|57:0.11|0.07"),
    },
    "male": {
        "voices": {"ja": "ja-JP-KeitaNeural", "en": "en-US-GuyNeural"},
        "rate": "-18%", "pitch": "-4Hz",
        "post": "highshelf=f=3200:g=-4",
    },
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


def encode(src, dest, post):
    chain = TRIM + ("," + post if post else "")
    chain += ",adelay=20,loudnorm=I=-18:TP=-2.0:LRA=7,aresample=44100"
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", src, "-af", chain,
        "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", dest,
    ], check=True)


def duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path],
        capture_output=True, text=True).stdout.strip()
    return float(out) if out else 0.0


async def main():
    import edge_tts

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg が見つかりません")

    wanted = sys.argv[1:] or list(VARIANTS)
    unknown = [w for w in wanted if w not in VARIANTS]
    if unknown:
        sys.exit("不明な種類: " + ", ".join(unknown))

    with open(os.path.join(HERE, "voice-phrases.json"), encoding="utf-8") as f:
        phrases = json.load(f)

    problems = []
    for vk in wanted:
        v = VARIANTS[vk]
        print("[%s]" % vk)
        for lang, items in phrases.items():
            os.makedirs(os.path.join(RAW, vk, lang), exist_ok=True)
            os.makedirs(os.path.join(OUT, vk, lang), exist_ok=True)

            for name, text in items.items():
                raw = os.path.join(RAW, vk, lang, name + ".mp3")
                dest = os.path.join(OUT, vk, lang, name + ".mp3")
                await edge_tts.Communicate(
                    text, v["voices"][lang],
                    rate=v["rate"], pitch=v["pitch"]).save(raw)
                encode(raw, dest, v["post"])

                d = duration(dest)
                limit = LIMITS.get(name)
                mark = ""
                if limit and d >= limit:
                    mark = "  ← %ss に収まらない" % limit
                    problems.append("%s/%s/%s (%.2fs >= %ss)"
                                    % (vk, lang, name, d, limit))
                print("  %-3s %-14s %5.2fs%s" % (lang, name, d, mark))

    if problems:
        print("\n収まらないクリップがあります:")
        for p in problems:
            print("  " + p)
        sys.exit(1)
    print("\n完了")


if __name__ == "__main__":
    asyncio.run(main())
