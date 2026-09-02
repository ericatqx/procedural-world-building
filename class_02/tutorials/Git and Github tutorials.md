# Class 02: Git and GitHub for Beginners

This tutorial is for people who have never used Git or GitHub. By the end, you should be able to save your work as **commits**, put a project on **GitHub**, and share changes with others.

---

## 1. What is Git? What is GitHub?

**Git** is a program on your computer that tracks changes to files. Think of it as a timeline of your project: every time you save a snapshot, you can go back to it later.

**GitHub** is a website that stores Git projects online. It is where you backup your work, collaborate, and submit assignments.

| | Git | GitHub |
|---|-----|--------|
| Where it lives | Your computer | The internet (github.com) |
| What it does | Records history of your files | Hosts that history so others can see it |
| Analogy | A notebook of every version | A cloud folder that shares that notebook |

You can use Git without GitHub. GitHub without Git does not really work — GitHub is built around Git.

---

## 2. Core words (learn these first)

- **Repository (repo):** a project folder that Git is tracking.
- **Commit:** a saved snapshot of your files, plus a short message explaining what changed.
- **Working tree:** the files you are editing right now.
- **Staging area:** a holding area. You choose which changes go into the next commit.
- **Branch:** a parallel line of work. `main` is usually the primary branch.
- **Remote:** a copy of the repo somewhere else (almost always GitHub). `origin` is the default name for that remote.
- **Clone:** download a GitHub repo onto your computer.
- **Push:** send your new commits from your computer to GitHub.
- **Pull:** download new commits from GitHub onto your computer.
- **Pull request (PR):** a request on GitHub to merge your branch into another branch (often `main`).

The usual flow looks like this:

```
edit files → git add (stage) → git commit (save snapshot) → git push (upload to GitHub)
```

---

## 3. Install Git

### Check if Git is already installed

Open Terminal (macOS) or Git Bash / Command Prompt (Windows) and run:

```bash
git --version
```

If you see a version number (for example `git version 2.39.0`), you are ready.

### macOS

1. Install [Homebrew](https://brew.sh) if you do not have it, then:

   ```bash
   brew install git
   ```

2. Or download the installer from [https://git-scm.com/download/mac](https://git-scm.com/download/mac).

Xcode Command Line Tools also include Git. If macOS prompts you to install them, accept.

### Windows

Download Git from [https://git-scm.com/download/win](https://git-scm.com/download/win). During setup, keep the defaults unless you know you need something else. Use **Git Bash** for the commands in this tutorial.

### Tell Git who you are (required once)

Every commit stores a name and email. Use the same email as your GitHub account:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Check what you set:

```bash
git config --global --list
```

---

## 4. Create a GitHub account

1. Go to [https://github.com](https://github.com) and sign up.
2. Pick a username you are comfortable showing on assignments (it is public).
3. Verify your email.

You will also need a way for your computer to talk to GitHub. Two common options:

- **HTTPS + Personal Access Token:** GitHub no longer accepts your account password for `git push`. You create a token in GitHub settings and paste it when Git asks for a password.
- **SSH keys:** you generate a key on your computer and add the public half to GitHub. After that, pushes do not ask for a password each time.

For class, HTTPS is often enough. GitHub’s docs: [Creating a personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

---

## 5. Your first local repository

Create a practice folder (this is not your class repo yet):

```bash
mkdir git-practice
cd git-practice
```

Turn the folder into a Git repo:

```bash
git init
```

You should see something like `Initialized empty Git repository`. Git now watches this folder.

Create a file:

```bash
echo "# Hello Git" > README.md
```

See what Git notices:

```bash
git status
```

You should see `README.md` listed as **untracked**. That means the file exists, but Git is not saving it yet.

### Stage, then commit

```bash
git add README.md
git status
```

The file should now be **staged** (ready to commit).

```bash
git commit -m "Add a README"
```

Good commit messages:

- Describe **why** or **what changed**, in the present tense: `"Add a README"`, `"Fix typo in title"`.
- Keep the first line short (about 50 characters).
- Do not write `"asdf"` or `"updates"`. Future-you will not remember what that meant.

See your history:

```bash
git log
```

Press `q` to leave the log view.

---

## 6. Everyday commands

Run these from **inside** the project folder.

| Command | What it does |
|---------|----------------|
| `git status` | Shows changed, staged, and untracked files. Use this constantly. |
| `git add filename` | Stages one file. |
| `git add .` | Stages all changes in this folder. Be careful — it includes everything. |
| `git commit -m "message"` | Saves a snapshot of staged files. |
| `git log --oneline` | Compact history. |
| `git diff` | Shows unstaged edits. |
| `git diff --staged` | Shows what will go into the next commit. |
| `git restore filename` | Discards unstaged edits to a file (cannot easily undo). |
| `git restore --staged filename` | Unstages a file but keeps your edits. |

Mental model:

1. **Edit** files in your editor.
2. **`git add`** the ones that belong in this snapshot.
3. **`git commit`** to lock that snapshot in.

You can commit many times before you ever push to GitHub.

---

## 7. Put the project on GitHub

On github.com:

1. Click the **+** menu → **New repository**.
2. Name it (for example `git-practice`).
3. Leave it **empty**: do **not** add a README, `.gitignore`, or license if you already have files locally. Two starting points (local vs GitHub) often cause merge headaches for beginners.
4. Click **Create repository**.

GitHub will show commands. If your local folder already has commits, use the “existing repository” path:

```bash
git remote add origin https://github.com/YOUR_USERNAME/git-practice.git
git branch -M main
git push -u origin main
```

- `origin` is a nickname for the GitHub URL.
- `-u origin main` remembers that `main` should push/pull against GitHub’s `main`. After this, `git push` and `git pull` are enough.

Refresh the GitHub page. Your files should appear.

### Clone (the other direction)

If the project already exists on GitHub and you want it on a new computer:

```bash
git clone https://github.com/YOUR_USERNAME/git-practice.git
cd git-practice
```

`git clone` copies the repo **and** sets `origin` for you. You do not need `git init` after a clone.

---

## 8. Branches (safe experiments)

A branch lets you try ideas without breaking `main`.

```bash
git branch                    # list branches
git switch -c feature-notes   # create and switch to a new branch
```

Older tutorials use `git checkout -b feature-notes`. `git switch` is the clearer modern command.

Edit a file, then:

```bash
git add .
git commit -m "Add notes on a branch"
git push -u origin feature-notes
```

On GitHub, open the repo. You should see a banner to create a **Pull Request**.

### Merge locally (optional practice)

```bash
git switch main
git merge feature-notes
```

In class and on teams, merging usually happens **on GitHub via a pull request**, not only on your laptop.

---

## 9. Pull requests (the GitHub workflow)

A **pull request** is: “Please take the commits on my branch and add them to `main`.”

Typical student / team flow:

1. `git switch main` and `git pull` so you start from the latest work.
2. `git switch -c my-feature` to create a branch named after the task.
3. Make changes, `git add`, `git commit`. Repeat as needed.
4. `git push -u origin my-feature`.
5. On GitHub: **Compare & pull request**. Write a short title and what you changed.
6. Someone reviews (or you review your own for homework). Then **Merge**.
7. Locally: `git switch main`, `git pull`, then you can delete the old branch.

```bash
git switch main
git pull
git branch -d my-feature
```

---

## 10. Working with this class repository

If the instructor gave you a GitHub URL for **procedural-world-building**:

```bash
git clone https://github.com/OWNER/procedural-world-building.git
cd procedural-world-building
```

Before you start work each session:

```bash
git switch main
git pull
```

Then create your own branch so you are not committing straight to `main` (unless the instructor says otherwise):

```bash
git switch -c class02-yourname
```

When you are ready to turn work in, push the branch and open a pull request.

### `.gitignore`

Some files should never be committed (secrets, huge binaries, OS junk). A `.gitignore` file lists them. Examples:

```
.DS_Store
.env
node_modules/
```

If a file is already committed, adding it to `.gitignore` later is not enough; you would need extra steps. Ask before committing API keys, passwords, or large datasets.

---

## 11. When things go wrong

**“Your branch is behind origin/main”**  
Someone else (or you, on another computer) pushed first. Run `git pull`, fix any conflicts, then `git push`.

**Merge conflict**  
The same lines were edited in two places. Git marks the file with `<<<<<<<`, `=======`, and `>>>>>>>`. Open the file, keep the correct version, delete the markers, then `git add` and `git commit`.

**Committed to the wrong branch**  
Do not panic. You can often create the right branch from here and open a PR. Ask before rewriting history (`git rebase`, `git reset --hard`) — those commands can delete work.

**Need to undo the last commit but keep the file changes**

```bash
git reset --soft HEAD~1
```

Only do this if you have **not** pushed yet, or if you understand you may need to force-push (avoid force-push on shared `main`).

**Accidentally `git add` too much**

```bash
git restore --staged filename
```

**Look at an old version without changing anything**

```bash
git log --oneline
git show COMMIT_HASH:path/to/file
```

---

## 12. Mini lab (do this)

1. Create a GitHub repo called `hello-git`.
2. On your computer, `git init`, add a `README.md` with your name and one sentence about why you are taking this class.
3. Commit and push to GitHub.
4. Create a branch `add-goals`, add three learning goals to the README, commit, push the branch.
5. Open a pull request and merge it into `main`.
6. On your computer, switch to `main` and `git pull`. Confirm the goals are there.

If each of those steps works, you have the skills this class needs.

---

## 13. Cheat sheet

```bash
# setup (once per machine)
git config --global user.name "Your Name"
git config --global user.email "you@example.com"

# start
git init
git clone https://github.com/USER/REPO.git

# daily
git status
git add .
git commit -m "Describe the change"
git pull
git push

# branches
git switch main
git switch -c new-branch-name
git branch

# connect to GitHub (existing local repo)
git remote add origin https://github.com/USER/REPO.git
git push -u origin main
```

---

## Further reading

- Official Git book (free): [https://git-scm.com/book/en/v2](https://git-scm.com/book/en/v2) — start with chapters 1–3.
- GitHub Hello World: [https://docs.github.com/en/get-started/quickstart/hello-world](https://docs.github.com/en/get-started/quickstart/hello-world)
- GitHub flow: [https://docs.github.com/en/get-started/using-github/github-flow](https://docs.github.com/en/get-started/using-github/github-flow)

Work in small commits. Run `git status` before and after almost every command until it feels automatic.
