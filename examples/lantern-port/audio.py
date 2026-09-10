"""Original gentle mechanical ambience and a short bell motif. No sampled media."""
import argparse,math,random,struct,wave
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--duration',type=float,default=8)
a=p.parse_args();rate=48000;n=int(rate*a.duration);random.seed(73)
left=[0.0]*n;right=[0.0]*n
# Quiet slow propeller flutter with low filtered wind.
wind=0.0
for i in range(n):
 t=i/rate;wind=.998*wind+.002*random.uniform(-1,1)
 edge=min(1,t/.25,max(0,(a.duration-t)/.7))
 flutter=.035*math.sin(2*math.pi*72*t)*(1+.3*math.sin(2*math.pi*6*t))
 sound=(wind*.55+flutter)*edge
 left[i]=sound*.85;right[i]=sound
# Warm tuned metal bells: an original, sparse pentatonic phrase.
for onset,pitch,gain,pan in [(0.18,261.625,.16,-.3),(1.15,391.995,.13,.2),(2.35,440,.11,-.15),(4.10,523.25,.12,.3),(5.65,391.995,.09,0),(6.32,659.255,.08,-.15)]:
 start=int(onset*rate)
 for k in range(min(int(2.5*rate),n-start)):
  t=k/rate;env=(1-math.exp(-t*85))*math.exp(-t*2.3)
  bell=math.sin(2*math.pi*pitch*t)+.25*math.sin(2*math.pi*pitch*2.76*t)*math.exp(-t*2)+.08*math.sin(2*math.pi*pitch*5.4*t)*math.exp(-t*5)
  v=gain*env*bell*min(1,max(0,(a.duration-(onset+t))/.5))
  left[start+k]+=v*(1-pan)*.5;right[start+k]+=v*(1+pan)*.5
out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True)
with wave.open(str(out),'wb') as w:
 w.setnchannels(2);w.setsampwidth(2);w.setframerate(rate)
 data=bytearray();master_gain=2.5
 for l,r in zip(left,right):data.extend(struct.pack('<hh',int(max(-1,min(1,l*master_gain))*32767),int(max(-1,min(1,r*master_gain))*32767)))
 w.writeframes(data)
print(out)
