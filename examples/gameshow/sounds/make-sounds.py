"""Makes the game show's sound effects and theme tune, with ffmpeg.

    python3 make-sounds.py

writes ding.mp3, buzzer.mp3, applause.mp3, fanfare.mp3 and theme.mp3 next to this file. They're
all synthesised, so there's no recording to credit or licence.
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

# The theme tune, which loops: an organ playing arpeggios over a bass line
NOTES = {"C2": 65.41, "D2": 73.42, "E2": 82.41, "F2": 87.31, "G2": 98.0, "A2": 110.0,
         "C4": 261.63, "D4": 293.66, "E4": 329.63, "F4": 349.23, "G4": 392.0, "A4": 440.0, "B4": 493.88,
         "C5": 523.25, "D5": 587.33, "E5": 659.25, "G5": 783.99}
MELODY = ("C5 E5 G5 E5 C5 E5 G5 E5 A4 C5 E5 C5 A4 C5 E5 C5 "
          "F4 A4 C5 A4 F4 A4 C5 A4 G4 B4 D5 B4 G4 B4 D5 G5").split()
BASS = "C2 C2 G2 G2 A2 A2 E2 E2 F2 F2 C2 C2 G2 G2 G2 G2".split()
STEP = 0.2  # seconds for each note of the melody


def tone(note: str, seconds: float, volume: float, brightness: float) -> list[str]:
    f = NOTES[note]
    expression = (f"{volume}*(sin(2*PI*{f}*t)+{brightness}*sin(4*PI*{f}*t)+{brightness / 2}*sin(6*PI*{f}*t))"
                  f"*min(1,t*80)*min(1,({seconds}-t)*30)")
    return ["-f", "lavfi", "-i", f"aevalsrc='{expression}':d={seconds}:s=44100"]


inputs = [arg for note in MELODY for arg in tone(note, STEP, 0.18, 0.5)]
inputs += [arg for note in BASS for arg in tone(note, STEP * 2, 0.3, 0.8)]
m, b = len(MELODY), len(BASS)
graph = ("".join(f"[{i}:a]" for i in range(m)) + f"concat=n={m}:v=0:a=1[melody];"
         + "".join(f"[{m + i}:a]" for i in range(b)) + f"concat=n={b}:v=0:a=1[bass];"
         + "[melody][bass]amix=inputs=2:normalize=0,lowpass=f=4000,aecho=0.6:0.4:60:0.25[out]")
ffmpeg(*inputs, "-filter_complex", graph, "-map", "[out]", *MP3, os.path.join(HERE, "theme.mp3"))
