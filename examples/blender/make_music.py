import math, random, wave, array, os
random.seed(72)
SR=44100;D=8;N=SR*D;left=array.array('f',[0])*N;right=array.array('f',[0])*N
pi=math.pi

def add(start,duration,fn,volume=1,pan=0):
 start=int(start*SR);count=min(int(duration*SR),N-start)
 for i in range(count):
  t=i/SR;v=fn(t)*volume
  left[start+i]+=v*(1-pan*.45);right[start+i]+=v*(1+pan*.45)
def freq(m):return 440*2**((m-69)/12)
for beat in range(16):
 # Pitch-swept round kick with a gentle click.
 add(beat*.5,.36,lambda t: math.sin(2*pi*(47*t+45*.035*(1-math.exp(-t/.035))))*math.exp(-t*14),.52)
 if beat%2:
  add(beat*.5,.18,lambda t:(random.random()*2-1)*math.exp(-t*27)*(1 if t<.012 or .021<t<.033 or t>.044 else .2),.19)
for i in range(32):
 add(i*.25+.01,.075,lambda t:(random.random()*2-1)*math.exp(-t*75)*math.sin(2*pi*7800*t),.1 if i%2 else .055,(-1 if i%2 else 1)*.25)
# Syncopated rubber bass, four two-second bars.
for bar in range(4):
 root=33 if bar%2==0 else 29
 for step,note,length in [(0,root,.20),(3,root,.13),(6,root+12,.12),(8,root+7,.2),(11,root+10,.13),(14,root+12,.17)]:
  hz=freq(note)
  add(bar*2+step*.125,length,lambda t,hz=hz,length=length:(math.sin(2*pi*hz*t)+.2*math.sin(4*pi*hz*t))*min(1,t/.006)*math.exp(-t*9)*min(1,(length-t)/.025),.22)
 # Short stereo electric-key stabs.
 notes=[57,60,64,71] if bar%2==0 else [53,57,60,67]
 for at in [.25,.875,1.5]:
  for j,note in enumerate(notes):
   hz=freq(note)
   add(bar*2+at,.38,lambda t,hz=hz:(math.sin(2*pi*hz*t+.8*math.sin(2*pi*hz*2*t)*math.exp(-t*8)))*min(1,t/.004)*math.exp(-t*12),.058,(j-1.5)/2)
 for k,note in enumerate(([76,79,81,83] if bar%2==0 else [79,76,74,72])):
  hz=freq(note)
  add(bar*2+.125+k*.5,.3,lambda t,hz=hz:math.sin(2*pi*hz*t)*math.exp(-t*18)*min(1,t/.003),.046,.5 if k%2 else -.5)
# A tiny stereo slapback blends the synthesized instruments.
for i in range(N-1,6000,-1):
 left[i]+=right[i-5512]*.10;right[i]+=left[i-6615]*.10 if i>=6615 else 0
out=array.array('h')
for i in range(N):
 fade=min(1,i/(SR*.015),(N-1-i)/(SR*.15))
 for channel in [left,right]:out.append(int(32767*math.tanh(channel[i]*1.25)*fade))
with wave.open(os.path.join(os.path.dirname(__file__),'after_hours_groove.wav'),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes(out.tobytes())
print('Original eight-second stereo groove composed.')
