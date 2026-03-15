# Plottimation Tool

## Purpose

This is a browser-based desktop tool for producing an animated GIF from a photograph or scan of an animation frame-sheet.

The source sheet contains:

- a regular grid of animation frames
- 4 corner registration circles
- interior `+` registration marks

The tool:

1. loads a photo or scan of the sheet
2. finds and rectifies the page
3. finds the corner dots
4. rectifies to the dot-defined sheet coordinate system
5. optionally refines frame geometry with the interior `+` marks
6. previews the animation
7. exports an animated GIF

---

## To Do

* Mobile-friendly (responsive) interface
* Handle light-on-dark animations on black paper.
* Use cross-only CV pipeline
* Deal with portrait/landscape
* Deal with multiple pages
* Memory consumption report
* Documentation screenrecording video

