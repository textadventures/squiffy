"""Makes the game show's sound effects, with ffmpeg.

    python3 make-sounds.py Sound_Effects_-_Applause_after_a_concert.ogg

writes ding.mp3, buzzer.mp3, fanfare.mp3 and applause.mp3 next to this file. The first three are
synthesised. The applause is a recording, made to sound like an old, worn-out tape of canned
applause: "Applause after a concert", by Amada44, which is in the public domain (CC0), from
https://commons.wikimedia.org/wiki/File:Sound_Effects_-_Applause_after_a_concert.ogg

The theme tune, theme.mp3, isn't made here: it's by Keehar.
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if len(sys.argv) != 2:
    sys.exit("Usage: python3 make-sounds.py <the applause recording>")
MP3 = ["-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "64k"]


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def generated(expression: str, seconds: float, filters: str | None, name: str) -> None:
    ffmpeg("-f", "lavfi", "-i", f"aevalsrc='{expression}':d={seconds}",
           *(["-af", filters] if filters else []), *MP3, os.path.join(HERE, name))


# Ding-ding! Two bright bell tones
generated("(0.5*sin(2*PI*1318.5*t)+0.3*sin(2*PI*2637*t)+0.15*sin(2*PI*3955*t))*exp(-6*t)*lt(t,0.18)"
          " + (0.5*sin(2*PI*1760*t)+0.3*sin(2*PI*3520*t))*exp(-4*(t-0.18))*gte(t,0.18)",
          1.1, None, "ding.mp3")

# The wrong-answer buzzer: two low square waves
generated("0.35*(sgn(sin(2*PI*98*t))+0.6*sgn(sin(2*PI*147*t)))*(1-exp(-60*t))*(1-0.3*t)",
          0.9, "lowpass=f=1800,afade=t=out:st=0.75:d=0.15", "buzzer.mp3")

# Canned applause, from the recording: 2.4 seconds of it, that starts and stops dead, through an
# old TV's speaker (300 Hz to 3.2 kHz, a little overdriven), with a slight tape wobble, hiss and the
# crackle of a worn-out recording mixed in
APPLAUSE_LENGTH = 2.4
ffmpeg("-ss", "12", "-t", str(APPLAUSE_LENGTH), "-i", sys.argv[1],
       "-f", "lavfi", "-t", str(APPLAUSE_LENGTH), "-i", "anoisesrc=c=pink:a=0.05:s=44100",
       "-f", "lavfi", "-t", str(APPLAUSE_LENGTH),
       "-i", "aevalsrc='0.9*gt(random(0),0.9992)*(2*random(1)-1)+0.25*gt(random(2),0.995)*(2*random(3)-1)':s=44100",
       "-filter_complex",
       "[0:a]aformat=channel_layouts=mono,aresample=44100,vibrato=f=0.7:d=0.08,"
       "highpass=f=300,highpass=f=300,lowpass=f=3200,lowpass=f=3200,"
       "acompressor=threshold=0.1:ratio=6:attack=5:release=50,volume=2.2,alimiter=limit=0.9[applause];"
       "[1:a]highpass=f=1000,lowpass=f=6000[hiss];"
       "[2:a]lowpass=f=5000[crackle];"
       "[applause][hiss][crackle]amix=inputs=3:normalize=0,"
       f"afade=t=in:d=0.01,afade=t=out:st={APPLAUSE_LENGTH - 0.008}:d=0.008",
       *MP3, os.path.join(HERE, "applause.mp3"))

# A fanfare: C E G, and a long top C
generated("0.3*(sgn(sin(2*PI*523.25*t))*between(t,0,0.14)+sgn(sin(2*PI*659.25*t))*between(t,0.15,0.29)"
          "+sgn(sin(2*PI*783.99*t))*between(t,0.3,0.44)"
          "+sgn(sin(2*PI*1046.5*t))*between(t,0.45,1.4)*(1+0.1*sin(2*PI*6*t)))",
          1.5, "lowpass=f=3500,afade=t=out:st=1.1:d=0.4", "fanfare.mp3")
