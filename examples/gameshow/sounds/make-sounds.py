"""Makes the game show's sound effects, with ffmpeg.

    python3 make-sounds.py

writes ding.mp3, buzzer.mp3, applause.mp3 and fanfare.mp3 next to this file. They're all
synthesised, so there's no recording to credit or licence. The theme tune, theme.mp3, isn't made
here: it's by Keehar.
"""

import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
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

# Applause: noise, fluttering, swelling and dying away
ffmpeg("-f", "lavfi", "-i", "anoisesrc=d=2.6:c=white:a=0.6",
       "-af", "highpass=f=700,lowpass=f=6000,tremolo=f=17:d=0.7,tremolo=f=23:d=0.5,"
              "afade=t=in:d=0.35,afade=t=out:st=1.3:d=1.3",
       *MP3, os.path.join(HERE, "applause.mp3"))

# A fanfare: C E G, and a long top C
generated("0.3*(sgn(sin(2*PI*523.25*t))*between(t,0,0.14)+sgn(sin(2*PI*659.25*t))*between(t,0.15,0.29)"
          "+sgn(sin(2*PI*783.99*t))*between(t,0.3,0.44)"
          "+sgn(sin(2*PI*1046.5*t))*between(t,0.45,1.4)*(1+0.1*sin(2*PI*6*t)))",
          1.5, "lowpass=f=3500,afade=t=out:st=1.1:d=0.4", "fanfare.mp3")
