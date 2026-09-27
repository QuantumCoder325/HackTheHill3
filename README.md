# INSTRUCTIONS OT RUN


```
sudo modprobe v4l2loopback video_nr=10 card_label="picam"
v4l2-ctl --list-devices # video10 should be listed as picam

rpicam-vid -t 0 --inline --width 640 --height 480 --codec yuv420 -o - | ffmpeg -f rawvideo -pix_fmt yuv420p -s 640x480 -i - -f v4l2 /dev/video10

bash
```


In a separate terminal in the project directory run:

```
npm install
npm start
bash
```
