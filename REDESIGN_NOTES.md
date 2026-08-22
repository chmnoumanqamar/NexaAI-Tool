# What changed in this update (latest)

## 1. Voice input switched from OpenAI Whisper to Google Gemini (free tier)
Whisper needs paid OpenAI billing, so transcription now goes through **Gemini** instead —
no credit card required. Nothing about how the mic button works changed, only what
happens on the backend:
1. Browser records your voice locally (`MediaRecorder`) — unchanged.
2. On stop, the audio is sent to `POST /api/transcribe` — unchanged.
3. The backend now forwards it to Google's **Gemini API** (`gemini-3.6-flash`) using your
   own `GEMINI_API_KEY`, and returns the transcribed text.

**You must add your Gemini key before this works:**
Open `Server/.env` and replace this line:
```
GEMINI_API_KEY=paste_your_gemini_key_here
```
with your real key from https://aistudio.google.com/apikey (free), then restart the
backend (`python main.py` or `npm run dev:all`). No new pip package is needed — it reuses
`requests`, which was already installed for Whisper.

Mic button behavior is unchanged: click once to start recording (turns into a red ⏹️),
click again to stop — it then shows a small spinner while transcribing, and drops the
text into the message box. Errors (blocked mic, no mic, missing API key, backend not
running) show a specific reason in the chip above the composer instead of a generic
failure.

## 2. App now always starts fresh (no more stuck/dummy name)
Previously your name was saved to the browser's local storage and silently reused on
every visit — so a name typed once while testing stayed stuck forever. The app no longer
restores a saved name on load: every time you open it, it starts at the "enter your name"
screen so you always type in the correct name for that session.

---

# What changed in the previous update

## 1. Fixed: AI wasn't replying (model deprecated)
Groq retired `llama-3.2-11b/90b-vision-preview` (the image-analysis models). They're
now `qwen/qwen3.6-27b` with a fallback to `meta-llama/llama-4-maverick-17b-128e-instruct`
in `Server/agent.py`. Your main chat model was already on `openai/gpt-oss-20b`, which is fine.

## 2. New: Quick Chat vs Project mode
After entering your name, you now choose:
- **💬 Quick AI Chat** — a private 1-on-1 space with the AI. No project name asked, ever.
- **📁 New Project** — asks for a project name, creates a shareable workspace, then
  immediately shows the invite screen.
- **🔗 Join a Project** — paste a teammate's invite link or workspace ID to join their project.

This solves "project ka naam har baar poochta hai" — it's now only asked when you
deliberately choose **New Project**.

## 3. New: Invite system (link + ID)
Every project has a `🔗 Invite` button (sidebar + header). It opens a modal with:
- A shareable link like `http://localhost:3000?join=proj-xxxxx` — opening it auto-fills
  the join screen for whoever clicks it.
- The raw workspace ID, for teammates who prefer to paste it manually.
Both have one-click "Copy" buttons.

## 4. New: Recent chats
Every workspace you enter (personal or project) is saved to your browser's local storage
and shown under **Recent** in the sidebar — click to switch instantly, without losing your
place. This is per-browser (not synced across devices) since there's no login system yet.

## 5. Fixed: buttons and message history
- Chat history now actually loads when you open or switch a workspace (previously it
  only showed messages received *after* you joined — a refresh wiped everything).
- Mic and attach buttons were already wired up; voice errors now show as a dismissible
  chip in the composer instead of a browser `alert()` popup (which some browsers block
  silently, making it look broken).
- Realtime chat + presence (who's online) are now scoped correctly per-workspace instead
  of a single hardcoded `demo-workspace`.

## Known limitation (not changed in this pass)
`Server/main.py`'s `/api/files` endpoint lists files from a single shared folder on the
server, not per-workspace. So the **Files** panel currently shows every file ever
generated across all workspaces, not just the active one. Flagging this in case you want
it scoped next — it needs a small backend change (a subfolder or a `workspace_id` column)
rather than a frontend fix.

## Run it
Same as before, from `AI_Workspace/Client`:
```
npm run dev:all
```
This starts both the Python backend (port 8000) and the Next.js frontend (port 3000)
in one terminal.

## Still flagged: rotate your keys
`Server/.env` has live Groq + Supabase keys that have now passed through several chat
sessions. Rotate both from your Groq and Supabase dashboards once you're done testing.
