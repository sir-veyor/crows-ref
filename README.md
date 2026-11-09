# Crows Ref Tool

A referee companion for the MCDM *Crows* public playtest (October 2026, playtest 3).
It's an unofficial fan tool. All game text belongs to MCDM.

## Put it on GitHub Pages

1. On github.com, click **New repository**. Give it a name (for example `crows-ref`) and create it.
2. On the new repo page, click **Add file → Upload files**. Drag in **everything in this folder**, including the `maps` folder. Then click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment*, set Source to **Deploy from a branch**, Branch to **main** and **/ (root)**, then click **Save**.
4. Wait a minute or two. Your tool will be live at `https://YOUR-USERNAME.github.io/crows-ref/`.

GitHub Pages sites are public to anyone who has the link, even if the repo is private (and Pages on a private repo needs a paid plan). Share the link only with your table.

You can also just double-click `index.html` to run it from your computer without GitHub.

## Saves

Timers, usage dice, combat, notes, roster, dungeon progress, pins and the roll log save automatically in **that browser on that device**. They survive closing the tab or restarting.
Use **Settings → Export save file** to back up or move your game to another device, and **Import** to load it.
Clearing your browser's site data erases the save.

## Install as an app

Open the site, then use your browser's **Install app** (Chrome/Edge) or **Share → Add to Home Screen** (iPhone). It opens in its own window and works offline.

## Updating

Replace the files in the repo and commit. The app fetches the newest files whenever it's online.

To add more dungeon maps, put the images in `maps/`, then add a line to `MAPS` near the middle of `app.js`, for example:
`'Floating Manor': 'maps/floating-manor.jpg',`
The name must match the dungeon's name. A "Show map" button then appears on that dungeon.

## Files

- `index.html`, `style.css`, `app.js`: the app
- `data.js`: all game content extracted from the playtest PDFs (rules, characters, The Ref, dungeons, item cards, pregens, changelog)
- `maps/`: Cornath and Blood Library maps
- `manifest.webmanifest`, `sw.js`, `icon-*.png`: install/offline support
