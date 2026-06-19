import cv2, numpy as np, json, face_recognition as FR, time
from pathlib import Path

ENROLLED_PATH = '/home/pi/enrolled_faces.json'
MAX_SAMPLES = 8

db = json.load(open(ENROLLED_PATH)) if Path(ENROLLED_PATH).exists() else {}
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
cap = cv2.VideoCapture('/dev/video1', cv2.CAP_V4L2)
cap.set(cv2.CAP_PROP_FOURCC,       cv2.VideoWriter_fourcc(*'MJPG'))
cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
cap.set(cv2.CAP_PROP_BUFFERSIZE,   1)
cap.set(cv2.CAP_PROP_FPS,          30)

name = input('Enter your name: ').strip()
print(f'Enrolling {name}...')
print('Stand in front of camera now...')
time.sleep(2)

samples = []
attempts = 0

while len(samples) < MAX_SAMPLES and attempts < 150:
    ret, frame = cap.read()
    if not ret: continue
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    rgb  = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    raw  = face_cascade.detectMultiScale(gray, 1.1, 4, minSize=(60,60))
    if len(raw) > 0:
        x,y,w,h = int(raw[0][0]),int(raw[0][1]),int(raw[0][2]),int(raw[0][3])
        locs = [(y, x+w, y+h, x)]
        encs = FR.face_encodings(rgb, known_face_locations=locs, num_jitters=2)
        if encs:
            samples.append(encs[0])
            print(f'Sample {len(samples)}/{MAX_SAMPLES} captured')
            time.sleep(0.5)
    attempts += 1
    time.sleep(0.1)

cap.release()

if len(samples) == MAX_SAMPLES:
    avg = np.mean(samples, axis=0)
    if name not in db:
        db[name] = {'embedding':[],'samples':0,'access_history':[],'status':'active'}
    db[name]['embedding'] = avg.tolist()
    db[name]['samples'] = MAX_SAMPLES
    with open(ENROLLED_PATH,'w') as f:
        json.dump(db,f,indent=2)
    print(f'SUCCESS: {name} enrolled!')
    print(f'All enrolled: {list(db.keys())}')
else:
    print(f'FAILED: only {len(samples)} samples — move closer to camera')
