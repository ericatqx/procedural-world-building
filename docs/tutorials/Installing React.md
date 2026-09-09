# Class 02: Install and Run React (for complete beginners)

This tutorial assumes you have **never used React** and are **new to the command line**. By the end you will have a small React app inside this class project, running in your browser.

We will use **Vite** to start the app. Vite is the usual beginner-friendly way to run React in 2026. You do not need to understand Vite yet — it is the tool that creates the project and starts the local website.

---

## 1. What is React? What do we need first?

**React** is a library for building websites as pieces called **components** (a button, a page, a map, and so on).

React does not install like a normal macOS/Windows app with a big Install button. You:

1. Install **Node.js** (a program that runs JavaScript on your computer).
2. Use the **command line** to create a React project.
3. Run a command that starts a **local server**.
4. Open a link in Chrome/Safari (usually `http://localhost:5173`).

Your classmates will not see that site on the internet. `localhost` means “this computer only.”

| Word | Meaning |
|------|---------|
| **Terminal / command line** | A text window where you type commands instead of clicking. On a Mac it is **Terminal**. On Windows use **Git Bash** or **PowerShell**. |
| **Node.js** | Lets your computer run JavaScript tools (including React’s tooling). |
| **npm** | Comes with Node. It installs packages (libraries) for a project. |
| **package.json** | A file that lists this app’s name, scripts, and dependencies. |
| **Local server** | A tiny website running on your machine while you develop. |

---

## 2. Command line survival kit (read this once)

Open the terminal:

- **Mac:** Spotlight (`Cmd + Space`), type `Terminal`, press Return.
- **Windows:** Open **Git Bash** if you installed Git in the other tutorial; otherwise search for **PowerShell**.

You will see a line where you can type. That folder is your **current directory** (your “location”). Commands run *in that folder*.

Useful commands:

```bash
pwd
```

Prints where you are (Mac / Git Bash). On PowerShell you can use `cd` with no path, or `Get-Location`.

```bash
ls
```

Lists files in this folder. On PowerShell, `dir` also works.

```bash
cd foldername
```

**Change directory** — move into a folder. Example: `cd Documents`.

```bash
cd ..
```

Move **up** one folder (the parent).

```bash
cd ~
```

Jump to your home folder (Mac / Git Bash).

Tips:

- Type a command, then press **Return/Enter**. Nothing runs until you press Enter.
- Copy commands from this file and paste. On a Mac, paste in Terminal with `Cmd + V`.
- Do **not** type the `$` if you see it in other tutorials. Type only the command itself.
- If a command is waiting for you (a question in the terminal), you can often press **Enter** to accept the default, or `Ctrl + C` to cancel.
- **`Ctrl + C`** stops a program that is running (including the React server). It does not copy text in the terminal.

If a command fails, read the red error. The most common beginner mistake is being in the **wrong folder**.

---

## 3. Install Node.js (once per computer)

React’s tools need Node.

### Check if you already have it

In the terminal:

```bash
node -v
npm -v
```

You want **Node 20 or newer** (for example `v20.11.0` or `v22.x`). If both commands print version numbers, skip to section 4.

If you see `command not found` or `not recognized`, install Node.

### Install (easiest path)

1. Go to [https://nodejs.org](https://nodejs.org).
2. Download the **LTS** installer (Long Term Support — the stable one).
3. Run the installer. Keep the defaults. Make sure the option to install **npm** is checked if you see it.
4. **Quit and reopen** your terminal (important — it will not see Node until you do).
5. Run `node -v` and `npm -v` again.

On a Mac, if the site installer is awkward, you can use Homebrew (only if you already have it):

```bash
brew install node
```

---

## 4. Go to this class project in the terminal

This repository is named **procedural-world-building**. You must `cd` into it before creating the React app.

If you cloned it with Git, it is probably under `Documents/GitHub`. Try this on a Mac:

```bash
cd ~/Documents/GitHub/procedural-world-building
pwd
ls
```

You should see folders like `class_02` and a `README.md`. If `cd` says **No such file or directory**, the project lives somewhere else:

1. In Finder, open the `procedural-world-building` folder.
2. On a Mac you can drag that folder onto the Terminal window after typing `cd ` (with a space). Terminal fills in the path. Press Enter.

Then move into the class 02 folder:

```bash
cd class_02
ls
```

You should see a `tutorials` folder. We will create the React app **next to** `tutorials`, as `class_02/react-app`, so class notes and the app stay together.

---

## 5. Create the React app

Stay in `class_02` (check with `pwd` — the path should end with `class_02`).

Run:

```bash
npm create vite@latest react-app -- --template react
```

What this means, in order:

- `npm create vite@latest` — ask npm to run the Vite starter.
- `react-app` — the new folder name.
- `-- --template react` — skip the interactive menus and pick a React (JavaScript) starter.

The first time, npm may ask you to confirm installing a package. Type `y` and press Enter.

If the command **opens questions** instead (folder name, framework, variant):

1. Project name: `react-app`
2. Framework: **React**
3. Variant: **JavaScript** (not TypeScript, unless your instructor says otherwise)

When it finishes you should have a new folder:

```bash
ls
```

You should see `react-app` and `tutorials`.

### Install the app’s libraries

Creating the folder is not enough. `npm install` downloads React and other packages into `node_modules` (a large folder — that is normal).

```bash
cd react-app
npm install
```

Wait until you get your prompt back and there is no error at the end. This can take a minute.

---

## 6. Run React in the browser

Still inside `react-app`, start the local server:

```bash
npm run dev
```

You should see something like:

```
  VITE v6.x.x  ready in 300 ms

  ➜  Local:   http://localhost:5173/
```

- Leave this terminal window **running**. Do not close it.
- Open a browser and go to **http://localhost:5173**
- You should see the Vite + React starter page (counter button, logos).

You are now running React in this project.

### Stop the server

Click the terminal, then press **`Ctrl + C`**. On a Mac that is Control, not Command.

### Start it again later

Every time you come back to work:

```bash
cd ~/Documents/GitHub/procedural-world-building/class_02/react-app
npm run dev
```

You do **not** need to run `npm create` or `npm install` again unless you delete `node_modules` or add new packages.

---

## 7. What you just created (quick tour)

Inside `class_02/react-app`:

| File or folder | Role |
|----------------|------|
| `package.json` | Project settings and scripts (`dev`, `build`). |
| `node_modules/` | Downloaded libraries. Do not edit this. Do not commit it if Git is ignoring it. |
| `index.html` | The single HTML page. React “mounts” into a `<div>` here. |
| `src/main.jsx` | Starts React and attaches it to the page. |
| `src/App.jsx` | The main component you will edit. |
| `src/App.css` | Styles for `App`. |
| `public/` | Static files (favicon, images) copied as-is. |

Open `src/App.jsx` in Cursor, change some text, and save. The browser should update by itself (**hot reload**). If it does not, refresh the page.

---

## 8. If something goes wrong

**`node: command not found`**  
Node is not installed, or the terminal was not restarted after installing. Close Terminal fully and open it again. Re-run `node -v`.

**`cd: No such file or directory`**  
You are not in the folder you think. Run `pwd` and `ls`. Use `cd ..` to go up, or start from `cd ~`.

**`npm create` fails with permission or EACCES errors**  
Do not use `sudo` unless an instructor tells you to. Reinstall Node from nodejs.org, or ask for help — permissions on global npm folders are a common Mac issue.

**Port 5173 already in use**  
Another `npm run dev` is probably still running in another terminal. Stop it with `Ctrl + C`, or use the new URL Vite prints (sometimes `5174`).

**The page is blank or an error overlay**  
Look at the terminal and the browser. A typo in `App.jsx` will show there. Undo your last edit or save the file again.

**I created the app in the wrong place**  
If the extra folder is empty of your own work, you can delete it in Finder and run section 5 again from `class_02`. If you already wrote code, move the `react-app` folder in Finder into `class_02`, then `cd` there and `npm run dev`.

**`npm run dev` says `ENOENT` / missing `package.json`**  
You are not inside `react-app`. `ls` should show `package.json`. Use `cd` until it does.

---

## 9. Mini lab (do this)

1. Confirm `node -v` and `npm -v` work.
2. `cd` into `procedural-world-building/class_02`.
3. Create `react-app` with Vite (section 5) and run `npm install`.
4. Run `npm run dev` and open `http://localhost:5173`.
5. In `src/App.jsx`, change the heading text to your name. Save and confirm the browser updates.
6. Stop the server with `Ctrl + C`, start it again with `npm run dev`, and confirm the page still loads.

If those steps work, you can install and run React in this project.

---

## 10. Cheat sheet

```bash
# once: check tools
node -v
npm -v

# go to class 02 (fix the path if your clone lives elsewhere)
cd ~/Documents/GitHub/procedural-world-building/class_02

# once: create the app
npm create vite@latest react-app -- --template react
cd react-app
npm install

# every work session
cd ~/Documents/GitHub/procedural-world-building/class_02/react-app
npm run dev
# then open http://localhost:5173
# stop with Ctrl + C
```

---

## Further reading

- Vite + React guide: [https://vite.dev/guide](https://vite.dev/guide)
- Official React “Quick Start”: [https://react.dev/learn](https://react.dev/learn)

You do not need to memorize React yet. Get the app running, then change `App.jsx` a little at a time.
