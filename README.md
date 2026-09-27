# INSTRUCTIONS OT RUN


```
rpicam-vid -t 0 --inline --framerate 30 --width 640 --height 480 --codec yuv420 -o - | \
ffmpeg -fflags nobuffer -flags low_delay -f rawvideo -pix_fmt yuv420p -s 640x480 -r 30 -i - -f v4l2 /dev/video10
```


In a separate terminal in the project directory run:

```
npm install
npm start
```
