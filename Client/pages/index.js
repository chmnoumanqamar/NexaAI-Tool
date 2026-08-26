import React, { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  "https://tjdaejrfnkytclzlijgb.supabase.co",
  "sb_publishable_hawLzzVRw9QQgg7ojogv3w_kp3VYB7M"
);

const API_BASE = "http://localhost:8000";

const SECURITY_QUESTIONS = [
  "What was the name of your first school?",
  "What is your favorite city?",
  "What was your childhood nickname?",
  "What is the name of your best friend?",
  "What was your first pet's name?",
];
const RECENTS_LIMIT = 20;

// User-scoped storage helpers: each account has its own isolated recents & active workspace
function getRecentsKey(username) {
  return username ? `workspace_recents_${username.toLowerCase().trim()}` : "workspace_recents_guest";
}

function getLastActiveKey(username) {
  return username ? `last_active_workspace_${username.toLowerCase().trim()}` : "last_active_workspace_guest";
}

function loadRecentsForUser(username) {
  if (typeof window === "undefined" || !username) return [];
  try {
    const raw = localStorage.getItem(getRecentsKey(username));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r) =>
        r &&
        r.id &&
        r.name &&
        r.name !== "New Chat" &&
        !r.name.startsWith("New Chat") &&
        r.name !== "Untitled Chat"
    );
  } catch {
    return [];
  }
}

function saveRecentsForUser(username, list) {
  if (typeof window === "undefined" || !username) return;
  try {
    localStorage.setItem(getRecentsKey(username), JSON.stringify((list || []).slice(0, RECENTS_LIMIT)));
  } catch {}
}

function upsertRecentForUser(username, entry) {
  if (!username) return [];
  if (
    !entry ||
    !entry.id ||
    !entry.name ||
    entry.name === "New Chat" ||
    entry.name.startsWith("New Chat") ||
    entry.name === "Untitled Chat"
  ) {
    return loadRecentsForUser(username);
  }
  const list = loadRecentsForUser(username);
  const filtered = list.filter((r) => r.id !== entry.id);
  const next = [{ ...entry, lastVisited: new Date().toISOString() }, ...filtered];
  saveRecentsForUser(username, next);
  return next;
}

// Parse a pasted invite link or raw workspace id into clean id + name
function parseWorkspaceDetails(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { id: "", name: "" };
  try {
    if (trimmed.includes("://") || trimmed.startsWith("localhost")) {
      const url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
      const fromQuery = url.searchParams.get("join");
      const nameQuery = url.searchParams.get("name");
      if (fromQuery) {
        return {
          id: fromQuery.trim(),
          name: nameQuery ? decodeURIComponent(nameQuery.trim()) : "",
        };
      }
    }
  } catch {
    // not a URL, fall through
  }
  return { id: trimmed.replace(/\s+/g, ""), name: "" };
}

function parseWorkspaceInput(raw) {
  return parseWorkspaceDetails(raw).id;
}

// ---- Lightweight, Safe Markdown & List Renderer ----
function renderFormattedMarkdown(text) {
  if (!text) return null;
  const lines = text.split("\n");
  const elements = [];
  let inCodeBlock = false;
  let codeBlockLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`} className="msg-code-block">
            <code>{codeBlockLines.join("\n")}</code>
          </pre>
        );
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    if (!line.trim()) {
      elements.push(<div key={`blank-${i}`} style={{ height: 6 }} />);
      continue;
    }

    // Bold, inline code, and bullet points parser
    let processedLine = line;
    const isBullet = /^\s*([•\-\*]|\d+\.)\s+/.test(processedLine);
    const isHeading = /^\s*#{1,4}\s+/.test(processedLine);
    let contentToFormat = processedLine;
    if (isBullet) {
      contentToFormat = processedLine.replace(/^\s*([•\-\*]|\d+\.)\s+/, "");
    } else if (isHeading) {
      contentToFormat = processedLine.replace(/^\s*#{1,4}\s+/, "");
    }

    // Helper to format inline tags (**bold**, `code`)
    const parts = [];
    let remaining = contentToFormat;
    let partKey = 0;

    while (remaining) {
      const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
      const codeMatch = remaining.match(/`(.*?)`/);

      let firstMatch = null;
      let matchType = null;

      if (boldMatch && (!codeMatch || boldMatch.index < codeMatch.index)) {
        firstMatch = boldMatch;
        matchType = "bold";
      } else if (codeMatch) {
        firstMatch = codeMatch;
        matchType = "code";
      }

      if (firstMatch) {
        const before = remaining.slice(0, firstMatch.index);
        if (before) parts.push(<span key={partKey++}>{before}</span>);
        if (matchType === "bold") {
          parts.push(<strong key={partKey++}>{firstMatch[1]}</strong>);
        } else {
          parts.push(<span key={partKey++} className="msg-inline-code">{firstMatch[1]}</span>);
        }
        remaining = remaining.slice(firstMatch.index + firstMatch[0].length);
      } else {
        parts.push(<span key={partKey++}>{remaining}</span>);
        remaining = "";
      }
    }

    if (isHeading) {
      elements.push(
        <div key={`h-${i}`} style={{ fontWeight: 800, fontSize: 15, margin: "6px 0 2px" }}>
          {parts}
        </div>
      );
    } else if (isBullet) {
      elements.push(
        <div key={`bullet-${i}`} style={{ display: "flex", gap: 6, margin: "3px 0", paddingLeft: 4 }}>
          <span style={{ opacity: 0.75, flexShrink: 0 }}>•</span>
          <span style={{ flex: 1 }}>{parts}</span>
        </div>
      );
    } else {
      elements.push(
        <p key={`p-${i}`} style={{ margin: "3px 0" }}>
          {parts}
        </p>
      );
    }
  }

  if (inCodeBlock && codeBlockLines.length > 0) {
    elements.push(
      <pre key="code-end" className="msg-code-block">
        <code>{codeBlockLines.join("\n")}</code>
      </pre>
    );
  }

  return elements;
}

// ---- Rich Message Component with Auto-Detected File Download Cards ----
function MessageContent({ content, isUser, onCopy }) {
  if (!content) return null;

  // 1. Handle user uploaded file tag: [File Uploaded: test.png]
  let displayContent = content;
  let userUploadedFilename = null;
  if (isUser && displayContent.includes("[File Uploaded:")) {
    const uploadMatch = displayContent.match(/\[File Uploaded:\s*([^\]]+)\]/i);
    if (uploadMatch) {
      userUploadedFilename = uploadMatch[1].trim();
      displayContent = displayContent.replace(/\[File Uploaded:\s*[^\]]+\]/i, "").trim();
    }
  }

  // 2. Extract download links (http://localhost:8000/api/download/filename.ext or /api/download/filename.ext)
  const downloadLinkMatches = [];
  const linkRegex = /(?:https?:\/\/[^\s\/]+)?\/api\/download\/([a-zA-Z0-9_\-\.\%]+)/gi;
  let match;
  while ((match = linkRegex.exec(displayContent)) !== null) {
    const rawFilename = match[1];
    const cleanFilename = decodeURIComponent(rawFilename);
    const downloadUrl = `http://localhost:8000/api/download/${rawFilename}`;
    if (!downloadLinkMatches.some((d) => d.filename === cleanFilename)) {
      downloadLinkMatches.push({
        filename: cleanFilename,
        downloadUrl,
      });
    }
  }

  // 3. Clean raw URL string and "Download Link:" prefix from the body text
  let textBody = displayContent;
  if (downloadLinkMatches.length > 0) {
    textBody = textBody
      .replace(/(?:https?:\/\/[^\s\/]+)?\/api\/download\/[a-zA-Z0-9_\-\.\%]+/gi, "")
      .replace(/Download Link:?\s*/gi, "")
      .replace(/Download link:?\s*/gi, "")
      .replace(/✅\s*([A-Za-z0-9\s]+)\s*successfully generated!?/gi, "")
      .trim();
  }

  return (
    <div className="msg-markdown">
      {userUploadedFilename && (
        <div className="user-upload-tag">
          📎 <span>{userUploadedFilename}</span>
        </div>
      )}

      {textBody && <div>{renderFormattedMarkdown(textBody)}</div>}

      {downloadLinkMatches.map((f, idx) => {
        const meta = fileMeta(f.filename);
        return (
          <div key={`dl-${idx}`} className="download-card">
            <div className="download-card-header">
              <div className="download-card-icon">{meta.icon}</div>
              <div className="download-card-details">
                <div className="download-card-title">{f.filename}</div>
                <div className="download-card-badge">
                  <span>✓ {meta.label} Document</span>
                  <span style={{ opacity: 0.5 }}>•</span>
                  <span>Ready to Download</span>
                </div>
              </div>
            </div>
            <div className="download-card-actions">
              <a
                href={f.downloadUrl}
                download={f.filename}
                className="download-btn-primary"
                title={`Download ${f.filename}`}
              >
                <span>⬇</span>
                <span>Download {meta.label} File</span>
              </a>
              <button
                type="button"
                className="download-btn-secondary"
                onClick={() => onCopy && onCopy(f.downloadUrl, "download_link")}
                title="Copy direct download URL"
              >
                📋 Link
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Workspace() {
  const [userName, setUserName] = useState(null); // Display Name e.g. "Nouman", "aoun"
  const [userUsername, setUserUsername] = useState(null); // Unique Username e.g. "nouman", "aoun"
  const [userId, setUserId] = useState("user-temp"); // Deterministic Unique ID e.g. "user-nouman", "user-aoun"
  const [theme, setTheme] = useState("light");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { id, name, type, x, y }
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [shareToast, setShareToast] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("workspace_theme") || "light";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("workspace_theme", next);
      document.documentElement.setAttribute("data-theme", next);
    }
  };
  const [authChecked, setAuthChecked] = useState(false); // avoids a login-screen flash while restoring a saved session

  // ---- Sign up / log in ----
  const [authMode, setAuthMode] = useState("login"); // "login" | "signup"
  const [authName, setAuthName] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authAge, setAuthAge] = useState("");
  const [authSecurityQuestion, setAuthSecurityQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [authSecurityAnswer, setAuthSecurityAnswer] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // ---- Forgot password (separate small flow, reuses the auth screen styling) ----
  const [forgotStage, setForgotStage] = useState("username"); // "username" | "answer"
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotQuestion, setForgotQuestion] = useState("");
  const [forgotAnswer, setForgotAnswer] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState("");

  // ---- Wizard step: auth -> mode -> newProject / joinProject -> active ----
  const [step, setStep] = useState("auth");
  const [pendingJoinId, setPendingJoinId] = useState(null);
  const [pendingJoinName, setPendingJoinName] = useState(null);

  // ---- Active workspace ----
  const [workspace, setWorkspace] = useState(null); // { id, name, type: 'personal' | 'project' }
  const [recents, setRecents] = useState([]);

  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [joinDraft, setJoinDraft] = useState("");
  const [joinError, setJoinError] = useState("");

  const [showInvite, setShowInvite] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [copiedField, setCopiedField] = useState("");

  const [messages, setMessages] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null); // { id, user_name, content } | null
  const [historyLoading, setHistoryLoading] = useState(false);

  // ---- Per-member threads + branches (team/project workspaces) ----
  // activeThread: { thread_id, owner_id, owner_name, isBranch, parentOwnerName }
  const [activeThread, setActiveThread] = useState(null);
  const [teamThreads, setTeamThreads] = useState([]); // each member's own thread
  const [branches, setBranches] = useState([]);
  const [inheritedCount, setInheritedCount] = useState(0); // # of msgs shown that came from the parent thread
  const [isBranching, setIsBranching] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState("");
  const [liveCaption, setLiveCaption] = useState("");
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const speechRecognitionRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [files, setFiles] = useState([]);
  const [serverStatus, setServerStatus] = useState("checking"); // checking | online | offline

  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const sendLockRef = useRef(false); // synchronous guard — React state (isLoading) updates async, so a fast double-fire (Enter + click) can slip through before a re-render; this can't.

  // ---- Restore a saved login session (token) + check ?join= link on load ----
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const joinParam = params.get("join");
    const nameParam = params.get("name");
    if (joinParam) {
      setPendingJoinId(joinParam);
      if (nameParam) {
        setPendingJoinName(nameParam);
      } else {
        fetch(`${API_BASE}/api/workspace/${encodeURIComponent(joinParam)}/meta`)
          .then((r) => r.json())
          .then((d) => {
            if (d?.workspace?.name && d.workspace.name !== joinParam && !d.workspace.name.startsWith("Project (") && !d.workspace.name.startsWith("Shared Project")) {
              setPendingJoinName(d.workspace.name);
            }
          })
          .catch(() => {});
      }
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
    }

    const token = localStorage.getItem("workspace_auth_token");
    if (!token) {
      setRecents([]);
      setAuthChecked(true);
      return;
    }

    fetch(`${API_BASE}/api/auth/me`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (data?.user?.username) {
          const realName = data.user.name;
          const realUsername = data.user.username.toLowerCase();
          const realUserId = "user-" + realUsername;

          setUserName(realName);
          setUserUsername(realUsername);
          setUserId(realUserId);

          const userRecents = loadRecentsForUser(realUsername);
          setRecents(userRecents);

          // Push local named projects to server
          for (const r of userRecents) {
            if (r.id && r.name && !r.name.startsWith("Shared Project") && !r.name.startsWith("Project (") && !r.name.startsWith("New Chat")) {
              fetch(`${API_BASE}/api/workspace`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: r.id, name: r.name, type: r.type || "project", created_by: realUserId })
              }).catch(() => {});
            }
          }

          // Auto-sync user's recent projects with actual names from server
          fetch(`${API_BASE}/api/workspaces`)
            .then((res) => (res.ok ? res.json() : Promise.reject()))
            .then((wData) => {
              if (wData?.workspaces) {
                setRecents((prev) => {
                  let changed = false;
                  const updated = prev.map((r) => {
                    const serverWs = wData.workspaces[r.id];
                    if (serverWs && serverWs.name && serverWs.name !== r.name && serverWs.name !== r.id && !serverWs.name.startsWith("Project (") && !serverWs.name.startsWith("Shared Project")) {
                      changed = true;
                      return { ...r, name: serverWs.name, type: serverWs.type || r.type };
                    }
                    return r;
                  });
                  if (changed) {
                    saveRecentsForUser(realUsername, updated);
                    return updated;
                  }
                  return prev;
                });
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        localStorage.removeItem("workspace_auth_token");
        localStorage.removeItem("workspace_active_username");
        setRecents([]);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  // ---- Route through the wizard once auth / join-link state is known ----
  useEffect(() => {
    if (!authChecked) return;
    if (!userName || !userUsername) {
      setStep("auth");
      return;
    }
    if (pendingJoinId) {
      setJoinDraft(pendingJoinId);
      setStep("joinProject");
      return;
    }
    if (step === "auth" || !workspace) {
      let restoredWs = null;
      try {
        const lastSaved = localStorage.getItem(getLastActiveKey(userUsername));
        if (lastSaved) {
          const parsed = JSON.parse(lastSaved);
          if (parsed && parsed.id) {
            restoredWs = parsed;
          }
        }
      } catch {}

      if (!restoredWs) {
        const currentRecents = loadRecentsForUser(userUsername);
        if (currentRecents.length > 0) {
          restoredWs = currentRecents[0];
        }
      }

      if (restoredWs) {
        enterWorkspace(restoredWs);
      } else {
        startNewChat();
      }
    }
  }, [userName, userUsername, pendingJoinId, authChecked]); // eslint-disable-line react-hooks/exhaustive-deps

  const doSignup = async () => {
    setAuthError("");
    const name = authName.trim();
    const username = authUsername.trim().toLowerCase();
    const age = Number(authAge);
    const securityAnswer = authSecurityAnswer.trim();
    if (!name || !username || !authPassword || !authAge) {
      setAuthError("Name, username, password, and age are all required.");
      return;
    }
    if (!Number.isFinite(age) || age <= 0) {
      setAuthError("Please enter a valid age.");
      return;
    }
    if (!securityAnswer) {
      setAuthError("Please answer the security question. It's used to reset your password later.");
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          username,
          password: authPassword,
          age,
          security_question: authSecurityQuestion,
          security_answer: securityAnswer,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Sign up failed.");

      const realName = data.user.name;
      const realUsername = data.user.username.toLowerCase();
      const realUserId = "user-" + realUsername;

      localStorage.setItem("workspace_auth_token", data.token);
      localStorage.setItem("workspace_active_username", realUsername);

      setUserName(realName);
      setUserUsername(realUsername);
      setUserId(realUserId);

      // BRAND NEW USER IS ALWAYS 100% CLEAN & BLANK
      setRecents([]);
      saveRecentsForUser(realUsername, []);
      localStorage.removeItem(getLastActiveKey(realUsername));

      setMessages([]);
      setTeamThreads([]);
      setBranches([]);

      if (pendingJoinId) {
        setJoinDraft(pendingJoinId);
        setStep("joinProject");
      } else {
        const id = genId("chat");
        enterWorkspace({ id, name: "New Chat", type: "personal" });
      }
    } catch (err) {
      setAuthError(String(err?.message || err));
    } finally {
      setAuthLoading(false);
    }
  };

  const doLogin = async () => {
    setAuthError("");
    const username = authUsername.trim().toLowerCase();
    if (!username || !authPassword) {
      setAuthError("Username and password are required.");
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: authPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Login failed.");

      const realName = data.user.name;
      const realUsername = data.user.username.toLowerCase();
      const realUserId = "user-" + realUsername;

      localStorage.setItem("workspace_auth_token", data.token);
      localStorage.setItem("workspace_active_username", realUsername);

      setUserName(realName);
      setUserUsername(realUsername);
      setUserId(realUserId);

      // Load ONLY this user's recents
      const userRecents = loadRecentsForUser(realUsername);
      setRecents(userRecents);

      setMessages([]);
      setTeamThreads([]);
      setBranches([]);

      if (pendingJoinId) {
        setJoinDraft(pendingJoinId);
        setStep("joinProject");
      } else {
        let restoredWs = null;
        try {
          const lastSaved = localStorage.getItem(getLastActiveKey(realUsername));
          if (lastSaved) {
            const parsed = JSON.parse(lastSaved);
            if (parsed && parsed.id) restoredWs = parsed;
          }
        } catch {}

        if (!restoredWs && userRecents.length > 0) {
          restoredWs = userRecents[0];
        }

        if (restoredWs) {
          enterWorkspace(restoredWs);
        } else {
          const id = genId("chat");
          enterWorkspace({ id, name: "New Chat", type: "personal" });
        }
      }
    } catch (err) {
      setAuthError(String(err?.message || err));
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    const token = localStorage.getItem("workspace_auth_token");
    localStorage.removeItem("workspace_auth_token");
    localStorage.removeItem("workspace_active_username");
    setUserName(null);
    setUserUsername(null);
    setUserId("user-temp");
    setWorkspace(null);
    setRecents([]);
    setMessages([]);
    setTeamThreads([]);
    setBranches([]);
    setAuthName("");
    setAuthUsername("");
    setAuthPassword("");
    setAuthAge("");
    setAuthSecurityAnswer("");
    setAuthMode("login");
    setStep("auth");
    if (token) {
      try {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
      } catch {
        // sign-out on the client already happened; a failed network call here is harmless
      }
    }
  };

  // ---- Forgot password: step 1, look up the account's security question ----
  const findSecurityQuestion = async () => {
    setForgotError("");
    setForgotSuccess("");
    const username = forgotUsername.trim();
    if (!username) {
      setForgotError("Please enter your username.");
      return;
    }
    setForgotLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/security-question?username=${encodeURIComponent(username)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Couldn't find that account.");
      setForgotQuestion(data.security_question);
      setForgotStage("answer");
    } catch (err) {
      setForgotError(String(err?.message || err));
    } finally {
      setForgotLoading(false);
    }
  };

  // ---- Forgot password: step 2, answer the question + set a new password ----
  const resetPassword = async () => {
    setForgotError("");
    if (!forgotAnswer.trim() || !forgotNewPassword) {
      setForgotError("Please answer the question and enter a new password.");
      return;
    }
    setForgotLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: forgotUsername.trim(),
          security_answer: forgotAnswer.trim(),
          new_password: forgotNewPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Couldn't reset the password.");
      // Back to the login screen, pre-filled, with a success note
      setAuthMode("login");
      setAuthUsername(forgotUsername.trim());
      setAuthPassword("");
      setForgotSuccess(data.message || "Password updated. Please log in with your new password.");
      setStep("auth");
      setForgotStage("username");
      setForgotUsername("");
      setForgotQuestion("");
      setForgotAnswer("");
      setForgotNewPassword("");
    } catch (err) {
      setForgotError(String(err?.message || err));
    } finally {
      setForgotLoading(false);
    }
  };

  // ---- Backend health check ----
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/`, { method: "GET" });
        if (!cancelled) setServerStatus(res.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setServerStatus("offline");
      }
    };
    check();
    const interval = setInterval(check, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ---- Files panel ----
  const refreshFiles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/files`);
      const data = await res.json();
      const cleanFiles = (data.files || []).filter(
        (f) => f.name && !f.name.startsWith(".") && f.name.toLowerCase() !== ".gitkeep"
      );
      setFiles(cleanFiles);
    } catch {
      // backend offline — leave files as-is
    }
  }, []);

  useEffect(() => { if (workspace) refreshFiles(); }, [workspace, refreshFiles]);

  // ---- Enter / switch a workspace ----
  const enterWorkspace = useCallback((entry) => {
    if (!entry || !entry.id) return;
    setSidebarOpen(false);
    setWorkspace(entry);
    setMessages([]);
    setSelectedFile(null);
    setReplyingTo(null);
    setActiveThread({ thread_id: `member-${userId}`, owner_id: userId, owner_name: userName, isBranch: false });
    setTeamThreads([]);
    setBranches([]);

    if (userUsername && typeof window !== "undefined") {
      try {
        localStorage.setItem(getLastActiveKey(userUsername), JSON.stringify(entry));
      } catch {}
    }

    if (
      userUsername &&
      entry.name &&
      entry.name !== "New Chat" &&
      !entry.name.startsWith("New Chat") &&
      entry.name !== "Untitled Chat"
    ) {
      const next = upsertRecentForUser(userUsername, entry);
      setRecents(next);
    }
    setStep("active");

    // Asynchronously resolve real name from server if currently a generic placeholder
    if (entry.id && (entry.name.startsWith("Project (") || entry.name.startsWith("Shared Project"))) {
      fetch(`${API_BASE}/api/workspace/${encodeURIComponent(entry.id)}/meta`)
        .then((r) => r.json())
        .then((d) => {
          if (d?.workspace?.name && d.workspace.name !== entry.id && !d.workspace.name.startsWith("Project (") && !d.workspace.name.startsWith("Shared Project")) {
            const actualName = d.workspace.name;
            setWorkspace((w) => (w?.id === entry.id ? { ...w, name: actualName } : w));
            if (userUsername) {
              setRecents((prev) => {
                const updated = prev.map((r) => (r.id === entry.id ? { ...r, name: actualName } : r));
                saveRecentsForUser(userUsername, updated);
                return updated;
              });
            }
          }
        })
        .catch(() => {});
    }
  }, [userId, userName, userUsername]);

  // ---- Refresh the list of team members' threads + branches ----
  const refreshThreads = useCallback(async () => {
    if (!workspace) return;
    try {
      const res = await fetch(`${API_BASE}/api/workspace/${workspace.id}/threads`);
      const data = await res.json();
      setTeamThreads(data.threads || []);
      setBranches(data.branches || []);
    } catch {
      // backend offline — leave as-is
    }
  }, [workspace]);

  useEffect(() => { refreshThreads(); }, [workspace, refreshThreads]);

  // ---- Switch which thread is being viewed (your own, a teammate's, or a branch) ----
  const viewThread = useCallback((thread) => {
    setSidebarOpen(false);
    setActiveThread(thread);
    setReplyingTo(null);
    setSelectedFile(null);
  }, []);

  // ---- Notifications: "X continued your chat from where you left off" ----
  const refreshNotifications = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE}/api/notifications?user_id=${encodeURIComponent(userId)}`);
      const data = await res.json();
      setNotifications(data.notifications || []);
    } catch {
      // backend offline — leave as-is
    }
  }, [userId]);

  useEffect(() => {
    refreshNotifications();
    const interval = setInterval(refreshNotifications, 10000);
    return () => clearInterval(interval);
  }, [refreshNotifications]);

  const openNotification = async (n) => {
    try {
      await fetch(`${API_BASE}/api/notifications/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      });
    } catch { /* best-effort */ }
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    if (n.branch_id && workspace) {
      viewThread({ thread_id: n.branch_id, owner_id: n.from_user_id, owner_name: n.from_user_name, isBranch: true });
    }
    setShowNotifications(false);
  };

  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  const startNewChat = () => {
    const id = genId("chat");
    enterWorkspace({ id, name: "New Chat", type: "personal" });
  };

  const createProject = async () => {
    const trimmed = projectNameDraft.trim();
    if (!trimmed) return;
    const id = genId("proj");
    const newWs = { id, name: trimmed, type: "project" };
    enterWorkspace(newWs);
    setProjectNameDraft("");
    setShowInvite(true);

    try {
      await fetch(`${API_BASE}/api/workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: trimmed,
          type: "project",
          created_by: userId,
        }),
      });
    } catch (e) {
      console.error("Save workspace notice:", e);
    }
  };

  const joinProject = async () => {
    const { id, name: parsedName } = parseWorkspaceDetails(joinDraft);
    if (!id) {
      setJoinError("Paste an invite link or workspace ID first.");
      return;
    }
    
    let resolvedName = parsedName || pendingJoinName || null;
    if (resolvedName && (resolvedName.startsWith("Project (") || resolvedName.startsWith("Shared Project"))) {
      resolvedName = null;
    }

    if (!resolvedName) {
      try {
        const res = await fetch(`${API_BASE}/api/workspace/${encodeURIComponent(id)}/meta`);
        if (res.ok) {
          const data = await res.json();
          if (data?.workspace?.name && data.workspace.name !== id && !data.workspace.name.startsWith("Project (") && !data.workspace.name.startsWith("Shared Project")) {
            resolvedName = data.workspace.name;
          }
        }
      } catch {}
    }

    if (!resolvedName) {
      const existing = recents.find((r) => r.id === id);
      if (existing?.name && !existing.name.startsWith("Project (") && !existing.name.startsWith("Shared Project")) {
        resolvedName = existing.name;
      }
    }

    const finalName = resolvedName || `Project (${id.slice(-6)})`;
    const newWs = { id, name: finalName, type: "project" };
    enterWorkspace(newWs);
    setJoinDraft("");
    setJoinError("");
    setPendingJoinId(null);
    setPendingJoinName(null);
  };

    const deleteRecentChat = (chatId) => {
    const next = recents.filter((r) => r.id !== chatId);
    setRecents(next);
    if (userUsername) {
      saveRecentsForUser(userUsername, next);
    }
    if (workspace?.id === chatId) {
      if (next.length > 0) {
        enterWorkspace(next[0]);
      } else {
        startNewChat();
      }
    }
    setContextMenu(null);
  };

  const shareRecentChat = async (chat) => {
    setContextMenu(null);
    const shareUrl = `${window.location.origin}/?join=${encodeURIComponent(chat.id)}&name=${encodeURIComponent(chat.name || "")}`;
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(shareUrl);
      setShareToast("Link copied to clipboard!");
      setTimeout(() => setShareToast(""), 2500);
    }
  };

  const renameRecentChat = (chatId, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    const next = recents.map((r) => (r.id === chatId ? { ...r, name: trimmed } : r));
    setRecents(next);
    if (userUsername) {
      saveRecentsForUser(userUsername, next);
    }
    if (workspace?.id === chatId) {
      setWorkspace((prev) => ({ ...prev, name: trimmed }));
    }
    setRenamingId(null);
    setContextMenu(null);
  };

  const switchToRecent = (entry) => {
    enterWorkspace(entry);
  };

  const goToMode = () => {
    setStep("mode");
  };

  // ---- Load message history whenever the active workspace OR active thread changes ----
  useEffect(() => {
    if (!workspace) return;
    const isProject = workspace.type === "project";
    const isBranch = activeThread?.isBranch || activeThread?.thread_id?.startsWith("branch-");
    if (isProject && !activeThread && !isBranch) return;
    let cancelled = false;
    setHistoryLoading(true);
    (async () => {
      try {
        const url = (isProject || isBranch) && activeThread?.thread_id
          ? `${API_BASE}/api/workspace/${workspace.id}/thread/${encodeURIComponent(activeThread.thread_id)}/messages`
          : `${API_BASE}/api/workspace/${workspace.id}/messages`;
        const res = await fetch(url);
        const data = await res.json();
        if (!cancelled) {
          setMessages(data.messages || []);
          setInheritedCount(data.inherited_count || 0);
        }
      } catch {
        if (!cancelled) { setMessages([]); setInheritedCount(0); }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspace, activeThread]);

  // ---- Realtime messages (scoped to active workspace) ----
  useEffect(() => {
    if (!userName || !workspace) return;
    try {
      const channel = supabase
        .channel(`room-${workspace.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload) => {
            if (payload?.new && payload.new.workspace_id === workspace.id) {
              const belongsToActiveThread =
                workspace.type !== "project" ||
                !activeThread ||
                payload.new.thread_id === activeThread.thread_id;
              if (belongsToActiveThread) {
                setMessages((prev) => {
                  const incoming = payload.new;
                  if (!incoming) return prev;
                  // If incoming message is AI, ensure consistent name
                  if (incoming.role === "ai" && incoming.user_name !== "System") {
                    incoming.user_name = "NexaAI";
                  }
                  if (incoming.id && prev.some((m) => m.id === incoming.id)) {
                    return prev;
                  }
                  const matchIndex = prev.findIndex(
                    (m) =>
                      m.role === incoming.role &&
                      m.content &&
                      incoming.content &&
                      m.content.trim() === incoming.content.trim()
                  );
                  if (matchIndex !== -1) {
                    const next = [...prev];
                    next[matchIndex] = { ...prev[matchIndex], ...incoming };
                    return next;
                  }
                  return [...prev, incoming];
                });
              }
              refreshFiles();
              refreshThreads();
            }
          }
        )
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' },
          (payload) => {
            if (payload?.new && payload.new.to_user_id === userId) {
              setNotifications((prev) => [payload.new, ...prev]);
            }
          }
        )
        .subscribe();
      return () => supabase.removeChannel(channel);
    } catch (err) {
      console.warn("Supabase realtime:", err.message);
    }
  }, [userName, userId, workspace, activeThread, refreshFiles, refreshThreads]);

  // ---- Presence (who's online) — scoped per workspace ----
  useEffect(() => {
    if (!userName || !workspace) return;
    const channel = supabase.channel(`presence-${workspace.id}`, {
      config: { presence: { key: userId } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const users = Object.values(state)
          .flat()
          .map((p) => p.user_name)
          .filter(Boolean);
        setOnlineUsers([...new Set(users)]);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_name: userName, online_at: new Date().toISOString() });
        }
      });

    return () => supabase.removeChannel(channel);
  }, [userName, userId, workspace]);

  // ---- Auto-scroll ----
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // ---- Auto-grow textarea ----
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [inputText]);

  // ---- Create / Fork a conversation branch from current or specific message ----
  const createBranchFromCurrent = async (branchPointMsgId = null) => {
    if (!workspace) return;
    setIsBranching(true);
    try {
      const parentThreadId = activeThread?.thread_id || (workspace.type === "project" ? `member-${userId}` : workspace.id);
      const parentOwnerId = activeThread?.owner_id || userId;
      const parentOwnerName = activeThread?.owner_name || userName || "Member";
      const lastMsgId = branchPointMsgId || (messages.length ? messages[messages.length - 1].id : null);

      const branchRes = await fetch(`${API_BASE}/api/workspace/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspace.id,
          parent_thread_id: parentThreadId,
          parent_owner_id: parentOwnerId,
          parent_owner_name: parentOwnerName,
          branch_point_message_id: lastMsgId,
          branch_owner_id: userId,
          branch_owner_name: userName || "Member",
        }),
      });
      const branchData = await branchRes.json().catch(() => ({}));
      if (!branchRes.ok) throw new Error(branchData?.detail || "Could not create branch.");

      const newBranchId = branchData.branch_id;
      const nextActiveThread = {
        thread_id: newBranchId,
        owner_id: userId,
        owner_name: userName || "Member",
        isBranch: true,
        parentOwnerName: parentOwnerName,
      };
      setActiveThread(nextActiveThread);
      refreshThreads();
      setShareToast("🌿 Branch created! You are now exploring an alternative path.");
      setTimeout(() => setShareToast(""), 3500);
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: "ai",
        user_name: "System",
        content: `⚠️ Could not create branch: ${String(err?.message || err)}`,
      }]);
    } finally {
      setIsBranching(false);
    }
  };

  const uploadSelectedFile = async () => {
    if (!selectedFile) return null;
    const formData = new FormData();
    formData.append("file", selectedFile);
    const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: formData });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  };

  const sendMessage = async (overrideText = null) => {
    const rawText = typeof overrideText === "string" ? overrideText : inputText;
    if ((!rawText.trim() && !selectedFile) || isLoading || !workspace) return;
    if (sendLockRef.current) return; // already sending — ignore the duplicate trigger
    sendLockRef.current = true;
    const textToSend = rawText.trim();
    setInputText("");
    setIsLoading(true);

    let fileTag = "";
    try {
      if (selectedFile) {
        const uploaded = await uploadSelectedFile();
        fileTag = `[File Uploaded: ${uploaded.filename}] `;
        setSelectedFile(null);
      }
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: "ai",
        user_name: "System",
        content: "⚠️ File upload failed. Please make sure the backend is running.",
      }]);
      setIsLoading(false);
      sendLockRef.current = false;
      return;
    }

    const finalMessage = fileTag + textToSend;

    // Auto-name fresh chats to the first instruction/prompt
    if (workspace && (workspace.name === "New Chat" || workspace.name.startsWith("New Chat") || workspace.name === "Untitled Chat") && textToSend.trim()) {
      let promptTitle = textToSend.trim();
      if (promptTitle.length > 36) {
        promptTitle = promptTitle.slice(0, 36).trim() + "…";
      }
      const updatedWorkspace = { ...workspace, name: promptTitle };
      setWorkspace(updatedWorkspace);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("last_active_workspace", JSON.stringify(updatedWorkspace));
        } catch {}
      }
      const nextRecents = upsertRecent(updatedWorkspace);
      setRecents(nextRecents);
    }
    const activeReply = replyingTo; // capture before clearing, so a race can't drop it
    setReplyingTo(null);

    // Are we typing into a thread that isn't ours and that we haven't already
    // branched? If so, fork it now: a brand-new private thread that starts
    // from exactly here, the original owner's thread stays untouched, and
    // they get notified.
    const viewingSomeoneElsesThread =
      workspace.type === "project" &&
      activeThread &&
      !activeThread.isBranch &&
      activeThread.owner_id !== userId;

    let threadForThisMessage = activeThread?.thread_id || `member-${userId}`;
    let nextActiveThread = activeThread;

    if (viewingSomeoneElsesThread) {
      setIsBranching(true);
      try {
        const lastShownMessageId = messages.length ? messages[messages.length - 1].id : null;
        const branchRes = await fetch(`${API_BASE}/api/workspace/branch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace_id: workspace.id,
            parent_thread_id: activeThread.thread_id,
            parent_owner_id: activeThread.owner_id,
            parent_owner_name: activeThread.owner_name,
            branch_point_message_id: lastShownMessageId,
            branch_owner_id: userId,
            branch_owner_name: userName,
          }),
        });
        const branchData = await branchRes.json().catch(() => ({}));
        if (!branchRes.ok) throw new Error(branchData?.detail || "Could not start a branch.");
        threadForThisMessage = branchData.branch_id;
        nextActiveThread = {
          thread_id: branchData.branch_id,
          owner_id: userId,
          owner_name: userName,
          isBranch: true,
          parentOwnerName: activeThread.owner_name,
        };
        setActiveThread(nextActiveThread);
        refreshThreads();
      } catch (err) {
        setMessages((prev) => [...prev, {
          role: "ai",
          user_name: "System",
          content: `⚠️ Couldn't start a branch: ${String(err?.message || err)}`,
        }]);
        setIsLoading(false);
        setIsBranching(false);
        sendLockRef.current = false;
        return;
      } finally {
        setIsBranching(false);
      }
    }

    setMessages((prev) => [...prev, {
      role: "user",
      user_name: userName,
      content: finalMessage,
      created_at: new Date().toISOString(),
      thread_id: threadForThisMessage,
      reply_to_id: activeReply?.id || null,
      reply_to_user_name: activeReply?.user_name || null,
      reply_to_content: activeReply?.content || null,
    }]);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspace.id,
          user_id: userId,
          user_name: userName,
          message: finalMessage,
          thread_id: threadForThisMessage,
          reply_to_id: activeReply?.id || null,
          reply_to_user_name: activeReply?.user_name || null,
          reply_to_content: activeReply?.content || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.reply) {
        setMessages((prev) => {
          const alreadyInList = prev.some(
            (m) =>
              m.role === "ai" &&
              m.content &&
              m.content.trim() === data.reply.trim()
          );
          if (alreadyInList) return prev;
          return [
            ...prev,
            {
              id: `local-ai-${Date.now()}`,
              role: "ai",
              user_name: "NexaAI",
              content: data.reply,
              created_at: new Date().toISOString(),
              thread_id: threadForThisMessage,
            },
          ];
        });
      }
      refreshFiles();
      refreshThreads();
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: "ai",
        user_name: "System",
        content: "⚠️ Could not reach the AI server. Make sure the backend is running on port 8000.",
      }]);
    } finally {
      setIsLoading(false);
      sendLockRef.current = false;
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startVoiceRecording = async () => {
    setVoiceNotice("");
    setLiveCaption("");
    if (isRecording || isTranscribing) return;
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setVoiceNotice("Voice recording isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];

      // Live on-screen captions while speaking — purely a visual "yes, it's listening"
      // cue. This is separate from the actual transcription: the real, accurate text
      // still comes from Gemini once you stop recording (below), which then replaces
      // whatever this preview shows.
      const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognitionApi) {
        try {
          const recognition = new SpeechRecognitionApi();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.onresult = (event) => {
            let combined = "";
            for (let i = 0; i < event.results.length; i++) {
              combined += event.results[i][0].transcript;
            }
            setLiveCaption(combined.trim());
          };
          recognition.onerror = () => {
            // Live preview is best-effort only — ignore failures silently,
            // Gemini transcription on stop is unaffected.
          };
          recognition.start();
          speechRecognitionRef.current = recognition;
        } catch {
          speechRecognitionRef.current = null;
        }
      }

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (speechRecognitionRef.current) {
          try { speechRecognitionRef.current.stop(); } catch { /* already stopped */ }
          speechRecognitionRef.current = null;
        }
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 500) {
          setLiveCaption("");
          setVoiceNotice("Didn't catch any audio. Try again and speak right after the mic turns red.");
          return;
        }
        setIsTranscribing(true);
        try {
          const formData = new FormData();
          const ext = (recorder.mimeType || "audio/webm").includes("mp4") ? "mp4" : "webm";
          formData.append("file", blob, `voice-input.${ext}`);
          const res = await fetch(`${API_BASE}/api/transcribe`, { method: "POST", body: formData });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data?.detail || `HTTP ${res.status}`);
          }
          const text = (data?.text || "").trim();
          if (text) {
            setInputText((prev) => (prev ? prev + " " : "") + text);
          } else {
            setVoiceNotice("Couldn't make out any speech. Try again.");
          }
        } catch (err) {
          const msg = String(err?.message || err);
          if (msg.includes("GEMINI_API_KEY")) {
            setVoiceNotice("Gemini key isn't set up on the server yet. Add GEMINI_API_KEY to Server/.env and restart the backend.");
          } else if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
            setVoiceNotice("Could not reach the backend. Make sure it's running on port 8000.");
          } else {
            setVoiceNotice(`Transcription failed: ${msg}`);
          }
        } finally {
          setIsTranscribing(false);
          setLiveCaption("");
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      setIsRecording(false);
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        setVoiceNotice("Microphone access was blocked. Click the 🔒/ⓘ icon next to the address bar → Site settings → allow Microphone, then reload.");
      } else if (err?.name === "NotFoundError") {
        setVoiceNotice("No microphone found. Check that one is connected and set as default.");
      } else {
        setVoiceNotice("Couldn't start the microphone. Try again.");
      }
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleVoiceRecording = () => {
    if (isRecording) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setSelectedFile(dropped);
  };

  const copyToClipboard = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(""), 1800);
    } catch {
      setCopiedField("");
    }
  };

  const inviteLink = (workspace && typeof window !== "undefined")
    ? `${window.location.origin}${window.location.pathname}?join=${encodeURIComponent(workspace.id)}&name=${encodeURIComponent(workspace.name || "")}`
    : "";

  // ============================================================
  // ---- Screen: restoring a saved session (avoid a login flash) ----
  // ============================================================
  if (!authChecked) {
    return (
      <>
        <Head><title>NexaAI</title></Head>
        <div style={styles.joinScreen} />
      </>
    );
  }

  // ============================================================
  // ---- Screen: sign up / log in ----
  // ============================================================
  if (step === "auth") {
    const isSignup = authMode === "signup";
    return (
      <>
        <Head><title>{isSignup ? "Sign Up" : "Log In"} | NexaAI</title></Head>
        <div style={styles.joinScreen}>
          {(authLoading || forgotLoading) && (
            <div className="progress-bar-track" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 110 }}>
              <div className="progress-bar-fill" />
            </div>
          )}
          <button
            style={styles.themeToggleFixed}
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <div className="join-card-responsive" style={styles.joinCard}>
            
            <h1 style={styles.joinTitle}>NexaAI</h1>
            <p style={styles.joinSubtitle}>
              {isSignup
                ? "Create an account to get started."
                : "Log in to your account to continue."}
            </p>

            {isSignup && (
              <input
                autoFocus
                style={styles.joinInput}
                placeholder="Your name"
                value={authName}
                onChange={(e) => setAuthName(e.target.value)}
                maxLength={40}
              />
            )}
            <input
              autoFocus={!isSignup}
              style={styles.joinInput}
              placeholder="Username"
              value={authUsername}
              onChange={(e) => setAuthUsername(e.target.value)}
              maxLength={40}
              autoCapitalize="none"
            />
            <div style={{ position: "relative" }}>
              <input
                style={{ ...styles.joinInput, paddingRight: 44 }}
                placeholder="Password"
                type={showPassword ? "text" : "password"}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (isSignup ? doSignup() : doLogin())}
                maxLength={100}
              />
              <button
                type="button"
                style={styles.passwordToggle}
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
            {isSignup && (
              <input
                style={styles.joinInput}
                placeholder="Age"
                type="number"
                min="1"
                max="120"
                value={authAge}
                onChange={(e) => setAuthAge(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSignup()}
              />
            )}
            {isSignup && (
              <select
                style={styles.joinInput}
                value={authSecurityQuestion}
                onChange={(e) => setAuthSecurityQuestion(e.target.value)}
              >
                {SECURITY_QUESTIONS.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            )}
            {isSignup && (
              <input
                style={styles.joinInput}
                placeholder="Your answer (used to reset your password later)"
                value={authSecurityAnswer}
                onChange={(e) => setAuthSecurityAnswer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSignup()}
                maxLength={100}
              />
            )}

            {!isSignup && forgotSuccess && (
              <p style={{ color: "var(--accent, #4caf50)", fontSize: 13, margin: "-4px 0 14px", textAlign: "left" }}>
                {forgotSuccess}
              </p>
            )}
            {authError && (
              <p style={{ color: "var(--danger)", fontSize: 13, margin: "-4px 0 14px", textAlign: "left" }}>
                {authError}
              </p>
            )}

            <button
              style={styles.joinButton}
              onClick={isSignup ? doSignup : doLogin}
              disabled={authLoading}
            >
              {authLoading ? "Please wait…" : (isSignup ? "Sign Up →" : "Log In →")}
            </button>
            <button
              style={styles.linkButton}
              type="button"
              onClick={() => {
                setAuthError("");
                setForgotSuccess("");
                setAuthMode(isSignup ? "login" : "signup");
              }}
            >
              {isSignup ? "Already have an account? Log in" : "Don't have an account? Sign up"}
            </button>
            {!isSignup && (
              <button
                style={{ ...styles.linkButton, marginTop: 2, fontSize: 13, opacity: 0.8 }}
                type="button"
                onClick={() => {
                  setAuthError("");
                  setForgotSuccess("");
                  setForgotError("");
                  setForgotStage("username");
                  setForgotUsername(authUsername.trim());
                  setStep("forgotPassword");
                }}
              >
                Forgot password?
              </button>
            )}
          </div>
        </div>
      </>
    );
  }

  // ============================================================
  // ---- Screen: forgot password ----
  // ============================================================
  if (step === "forgotPassword") {
    return (
      <>
        <Head><title>Reset Password | NexaAI</title></Head>
        <div style={styles.joinScreen}>
          <button
            style={styles.themeToggleFixed}
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <div className="join-card-responsive" style={styles.joinCard}>
            
            <h1 style={styles.joinTitle}>Reset Password</h1>
            <p style={styles.joinSubtitle}>
              {forgotStage === "username"
                ? "Enter your username to find your security question."
                : "Answer your security question and choose a new password."}
            </p>

            {forgotStage === "username" && (
              <input
                autoFocus
                style={styles.joinInput}
                placeholder="Username"
                value={forgotUsername}
                onChange={(e) => setForgotUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && findSecurityQuestion()}
                maxLength={40}
                autoCapitalize="none"
              />
            )}

            {forgotStage === "answer" && (
              <>
                <p style={{ fontSize: 14, margin: "-6px 0 12px", textAlign: "left", opacity: 0.85 }}>
                  {forgotQuestion}
                </p>
                <input
                  autoFocus
                  style={styles.joinInput}
                  placeholder="Your answer"
                  value={forgotAnswer}
                  onChange={(e) => setForgotAnswer(e.target.value)}
                  maxLength={100}
                />
                <div style={{ position: "relative" }}>
                  <input
                    style={{ ...styles.joinInput, paddingRight: 44 }}
                    placeholder="New password"
                    type={showForgotPassword ? "text" : "password"}
                    value={forgotNewPassword}
                    onChange={(e) => setForgotNewPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && resetPassword()}
                    maxLength={100}
                  />
                  <button
                    type="button"
                    style={styles.passwordToggle}
                    onClick={() => setShowForgotPassword((v) => !v)}
                    title={showForgotPassword ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showForgotPassword ? "🙈" : "👁️"}
                  </button>
                </div>
              </>
            )}

            {forgotError && (
              <p style={{ color: "var(--danger)", fontSize: 13, margin: "-4px 0 14px", textAlign: "left" }}>
                {forgotError}
              </p>
            )}

            <button
              style={styles.joinButton}
              onClick={forgotStage === "username" ? findSecurityQuestion : resetPassword}
              disabled={forgotLoading}
            >
              {forgotLoading
                ? "Please wait…"
                : forgotStage === "username"
                  ? "Continue →"
                  : "Reset Password →"}
            </button>
            <button
              style={styles.linkButton}
              type="button"
              onClick={() => {
                setForgotError("");
                setStep("auth");
                setAuthMode("login");
                setForgotStage("username");
              }}
            >
              ← Back to log in
            </button>
          </div>
        </div>
      </>
    );
  }

  // ============================================================
  // ---- Screen: choose mode ----
  // ============================================================
  if (step === "mode") {
    return (
      <>
        <Head><title>NexaAI</title></Head>
        <div style={styles.joinScreen}>
          <button
            style={styles.themeToggleFixed}
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <div style={{ ...styles.joinCard, maxWidth: 560, textAlign: "left" }}>
            
            <h1 style={{ ...styles.joinTitle, textAlign: "center" }}>Hi {userName} 👋</h1>
            <p style={{ ...styles.joinSubtitle, textAlign: "center" }}>What would you like to do?</p>

            <div style={styles.modeGrid}>
              <button style={styles.modeCard} onClick={startNewChat}>
                <span style={styles.modeIcon}>💬</span>
                <span style={styles.modeTitle}>Quick AI Chat</span>
                <span style={styles.modeDesc}>Just you and NexaAI. No setup, jump straight in.</span>
              </button>
              <button style={styles.modeCard} onClick={() => setStep("newProject")}>
                <span style={styles.modeIcon}>📁</span>
                <span style={styles.modeTitle}>New Project</span>
                <span style={styles.modeDesc}>Create a shared workspace and invite your team.</span>
              </button>
              <button style={styles.modeCard} onClick={() => setStep("joinProject")}>
                <span style={styles.modeIcon}>🔗</span>
                <span style={styles.modeTitle}>Join a Project</span>
                <span style={styles.modeDesc}>Paste an invite link or workspace ID.</span>
              </button>
            </div>

            {recents.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div style={styles.sidebarLabel}>Recent</div>
                <div style={styles.recentList}>
                  {recents.slice(0, 5).map((r) => (
                    <button key={r.id} style={styles.recentRow} onClick={() => switchToRecent(r)}>
                      <span style={{ ...styles.recentIcon, background: r.type === "project" ? "var(--accent-tint-25)" : "var(--ai-bubble)" }}>
                        {r.type === "project" ? "📁" : "💬"}
                      </span>
                      <span style={styles.recentInfo}>
                        <span style={styles.recentName}>{r.name}</span>
                        <span style={styles.recentSub}>{formatRelative(r.lastVisited)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // ============================================================
  // ---- Screen: create new project ----
  // ============================================================
  if (step === "newProject") {
    return (
      <>
        <Head><title>New Project</title></Head>
        <div style={styles.joinScreen}>
          <button
            style={styles.themeToggleFixed}
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <div className="join-card-responsive" style={styles.joinCard}>
            
            <h1 style={styles.joinTitle}>Name your project</h1>
            <p style={styles.joinSubtitle}>You'll get a shareable link and ID right after. Invite teammates anytime.</p>
            <input
              autoFocus
              style={styles.joinInput}
              placeholder="e.g. Q4 Marketing Report"
              value={projectNameDraft}
              onChange={(e) => setProjectNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProject()}
              maxLength={60}
            />
            <button style={styles.joinButton} onClick={createProject} disabled={!projectNameDraft.trim()}>
              Create project →
            </button>
            <button style={styles.linkButton} onClick={() => { if (workspace) setStep("active"); else startNewChat(); }}>← Back</button>
          </div>
        </div>
      </>
    );
  }

  // ============================================================
  // ---- Screen: join a project ----
  // ============================================================
  if (step === "joinProject") {
    return (
      <>
        <Head><title>Join Project</title></Head>
        <div style={styles.joinScreen}>
          <button
            style={styles.themeToggleFixed}
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <div className="join-card-responsive" style={styles.joinCard}>
            
            <h1 style={styles.joinTitle}>Join a project</h1>
            <p style={styles.joinSubtitle}>Paste the invite link or workspace ID your teammate sent you.</p>
            <input
              autoFocus
              style={styles.joinInput}
              placeholder="Invite link or workspace ID"
              value={joinDraft}
              onChange={(e) => { setJoinDraft(e.target.value); setJoinError(""); }}
              onKeyDown={(e) => e.key === "Enter" && joinProject()}
            />
            {joinError && <p style={styles.errorText}>{joinError}</p>}
            <button style={styles.joinButton} onClick={joinProject} disabled={!joinDraft.trim()}>
              Join project →
            </button>
            <button style={styles.linkButton} onClick={() => { setPendingJoinId(null); if (workspace) setStep("active"); else startNewChat(); }}>← Back</button>
          </div>
        </div>
      </>
    );
  }

  // ============================================================
  // ---- Main workspace screen ----
  // ============================================================
  if (!workspace) return null;

  const projectRecents = recents.filter((r) => r.type === "project");
  const chatRecents = recents.filter((r) => r.type !== "project");

  return (
    <>
      <Head>
        <title>{workspace.name} | NexaAI</title>
      </Head>
      <div
        style={styles.app}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {/* ===== Sidebar ===== */}
        {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
        <aside className={`sidebar-container ${sidebarOpen ? "open" : ""}`} style={{ ...styles.sidebar, ...(sidebarCollapsed ? { display: "none" } : {}) }}>
          {/* 1. FIXED TOP HEADER: NexaAI + Action buttons (NEVER SCROLLS) */}
          <div style={styles.sidebarTopFixed}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ ...styles.brandRow, marginBottom: 0 }}>
                <div style={styles.brandMark}>NX</div>
                <div style={styles.brandName} className="brand-font">NexaAI</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  style={styles.collapseToggleBtn}
                  onClick={() => setSidebarCollapsed(true)}
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                >
                  «
                </button>
                <button
                  type="button"
                  className="mobile-only"
                  style={styles.sidebarCloseBtn}
                  onClick={() => setSidebarOpen(false)}
                  title="Close sidebar"
                >
                  ✕
                </button>
              </div>
            </div>

            <div style={styles.actionButtonsStack}>
              <button
                type="button"
                style={styles.sidebarActionBtnPrimary}
                onClick={startNewChat}
                title="Start a new chat"
              >
                <span style={{ fontSize: 16 }}>＋</span>
                <span>New Chat</span>
              </button>
              <button
                type="button"
                style={styles.sidebarActionBtnSecondary}
                onClick={() => setStep("newProject")}
                title="Create a new shared project"
              >
                <span style={{ fontSize: 14 }}>📁</span>
                <span>New Project</span>
              </button>
              <button
                type="button"
                style={styles.sidebarActionBtnSecondary}
                onClick={() => setStep("joinProject")}
                title="Join an existing project"
              >
                <span style={{ fontSize: 14 }}>🔗</span>
                <span>Join Project</span>
              </button>
            </div>
          </div>

          {/* 2. SCROLLABLE MIDDLE LIST: Team, Recents, Chats, Branches, Files (ONLY THIS SECTION SCROLLS) */}
          <div style={styles.sidebarScrollableContent}>
            {workspace?.type === "project" && (
              <div style={styles.sidebarSection}>
                <div style={styles.sidebarLabel}>
                  Team ({onlineUsers.length || 1} online)
                </div>
                <div style={styles.memberList}>
                  {(onlineUsers.length ? onlineUsers : [userName]).map((name) => (
                    <div key={name} style={styles.memberRow}>
                      <div style={{ ...styles.avatar, background: hashToShade(name) }}>
                        {initials(name)}
                      </div>
                      <span style={styles.memberName}>
                        {name} {name === userName && <span style={styles.youTag}>you</span>}
                      </span>
                      <span style={styles.onlineDot} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 1. PROJECTS / TEAM WORKSPACES */}
            {projectRecents.length > 0 && (
              <div style={styles.sidebarSection}>
                <div style={styles.sidebarLabel}>Projects</div>
                <div style={styles.recentListCompact}>
                  {projectRecents.map((r) => {
                    const isProjectActive = workspace?.id === r.id;
                    return (
                      <div key={r.id} style={{ position: "relative", width: "100%" }}>
                        {renamingId === r.id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", padding: "4px 6px" }}>
                            <input
                              autoFocus
                              style={styles.renameInput}
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") renameRecentChat(r.id, renameDraft);
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              onBlur={() => renameRecentChat(r.id, renameDraft)}
                            />
                          </div>
                        ) : (
                          <>
                            <div
                              className="recent-item-row"
                              style={{
                                ...styles.recentRowCompact,
                                ...(isProjectActive && workspace.type === "project" ? styles.recentRowActive : {}),
                                justifyContent: "space-between",
                                cursor: "pointer",
                              }}
                              onClick={() => switchToRecent(r)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                const clientX = Math.min(e.clientX, window.innerWidth - 180);
                                const clientY = Math.min(e.clientY, window.innerHeight - 160);
                                setContextMenu({ id: r.id, name: r.name, type: r.type, x: clientX, y: clientY });
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1, cursor: "pointer" }}>
                                <span style={styles.recentIconSm}>📁</span>
                                <span style={{ ...styles.recentNameSm, fontWeight: isProjectActive ? 700 : 500 }}>{r.name}</span>
                              </div>
                              <button
                                type="button"
                                className="recent-options-btn"
                                style={styles.recentOptionsBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setContextMenu({
                                    id: r.id,
                                    name: r.name,
                                    type: r.type,
                                    x: Math.min(rect.right + 4, window.innerWidth - 180),
                                    y: Math.min(rect.top, window.innerHeight - 160),
                                  });
                                }}
                                title="Options"
                              >
                                ⋯
                              </button>
                            </div>

                            {/* NESTED SUB-CHATS & BRANCHES: STRICTLY UNDER THIS ACTIVE PROJECT */}
                            {isProjectActive && workspace.type === "project" && (
                              <div className="project-nested-chats" style={styles.projectNestedContainer}>
                                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-soft)", padding: "3px 6px 1px", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                                  Team Chats
                                </div>
                                <button
                                  type="button"
                                  style={{
                                    ...styles.recentRowNested,
                                    ...(!activeThread || (activeThread.owner_id === userId && !activeThread.isBranch) ? styles.recentRowNestedActive : {}),
                                  }}
                                  onClick={() => viewThread(null)}
                                >
                                  <span style={styles.recentIconSm}>🟢</span>
                                  <span style={styles.recentNameSm}>You</span>
                                </button>
                                {teamThreads
                                  .filter((t) => t.owner_id !== userId && !t.isBranch)
                                  .map((t) => {
                                    const isSelected = activeThread?.owner_id === t.owner_id && !activeThread?.isBranch;
                                    return (
                                      <button
                                        key={t.owner_id}
                                        type="button"
                                        style={{
                                          ...styles.recentRowNested,
                                          ...(isSelected ? styles.recentRowNestedActive : {}),
                                        }}
                                        onClick={() => viewThread({ ...t, isBranch: false })}
                                      >
                                        <span style={styles.recentIconSm}>👤</span>
                                        <span style={styles.recentNameSm}>{t.owner_name}</span>
                                      </button>
                                    );
                                  })}

                                {/* Branch Sub-chats for this project */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 6px 1px", fontSize: 10.5, fontWeight: 700, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                                  <span>Branches {branches.length > 0 ? `(${branches.length})` : ""}</span>
                                  <span
                                    style={{ color: "var(--navy)", cursor: "pointer", fontSize: 11, fontWeight: 700, textTransform: "none" }}
                                    onClick={(e) => { e.stopPropagation(); createBranchFromCurrent(); }}
                                    title="Create new branch"
                                  >
                                    + Branch
                                  </span>
                                </div>
                                {branches.map((b) => {
                                  const bId = b.id || b.branch_id;
                                  const isSelected = activeThread?.thread_id === bId;
                                  return (
                                    <button
                                      key={bId}
                                      type="button"
                                      style={{
                                        ...styles.recentRowNested,
                                        ...(isSelected ? styles.recentRowNestedActive : {}),
                                      }}
                                      onClick={() => viewThread({
                                        thread_id: bId,
                                        owner_id: b.branch_owner_id,
                                        owner_name: b.branch_owner_name,
                                        isBranch: true,
                                        parentOwnerName: b.parent_owner_name,
                                      })}
                                    >
                                      <span style={styles.recentIconSm}>🌿</span>
                                      <span style={styles.recentNameSm}>
                                        {b.branch_owner_id === userId
                                          ? `Your branch (${(b.parent_owner_name || "chat").split(" ")[0]})`
                                          : `${b.branch_owner_name}'s branch`}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2. RECENT CHATS (ONLY PERSONAL / DIRECT CHATS) */}
            {chatRecents.length > 0 && (
              <div style={styles.sidebarSection}>
                <div style={styles.sidebarLabel}>Recent Chats</div>
                <div style={styles.recentListCompact}>
                  {chatRecents.map((r) => (
                    <div
                      key={r.id}
                      style={{ position: "relative", width: "100%", cursor: "pointer" }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        const clientX = Math.min(e.clientX, window.innerWidth - 180);
                        const clientY = Math.min(e.clientY, window.innerHeight - 160);
                        setContextMenu({ id: r.id, name: r.name, type: r.type, x: clientX, y: clientY });
                      }}
                    >
                      {renamingId === r.id ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", padding: "4px 6px" }}>
                          <input
                            autoFocus
                            style={styles.renameInput}
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") renameRecentChat(r.id, renameDraft);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            onBlur={() => renameRecentChat(r.id, renameDraft)}
                          />
                        </div>
                      ) : (
                        <div
                          className="recent-item-row"
                          style={{
                            ...styles.recentRowCompact,
                            ...(r.id === workspace?.id && workspace?.type !== "project" ? styles.recentRowActive : {}),
                            justifyContent: "space-between",
                            cursor: "pointer",
                          }}
                          onClick={() => switchToRecent(r)}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1, cursor: "pointer" }}>
                            <span style={styles.recentIconSm}>💬</span>
                            <span style={styles.recentNameSm}>{r.name}</span>
                          </div>
                          <button
                            type="button"
                            className="recent-options-btn"
                            style={styles.recentOptionsBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setContextMenu({
                                id: r.id,
                                name: r.name,
                                type: r.type,
                                x: Math.min(rect.right + 4, window.innerWidth - 180),
                                y: Math.min(rect.top, window.innerHeight - 160),
                              });
                            }}
                            title="Options"
                          >
                            ⋯
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {files.length > 0 && (
              <div style={styles.sidebarSection}>
                <div style={styles.sidebarLabel}>Files in this workspace ({files.length})</div>
                <div style={styles.filesList}>
                  {files.map((f) => {
                    const meta = fileMeta(f.name);
                    return (
                      <a
                        key={f.name}
                        href={f.download_url}
                        target="_blank"
                        rel="noreferrer"
                        style={styles.fileRow}
                      >
                        <span style={styles.fileIcon}>{meta.icon}</span>
                        <span style={styles.fileInfo}>
                          <span style={styles.fileName}>{f.name}</span>
                          <span style={styles.fileSub}>{meta.label} · {formatBytes(f.size)}</span>
                        </span>
                        <span style={styles.fileDownload}>↓</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 3. FIXED BOTTOM USER PROFILE: ALWAYS PINNED AT THE BOTTOM (NEVER SCROLLS) */}
          <div style={styles.sidebarBottomFixed}>
            {showUserMenu && (
              <>
                <div style={styles.userMenuBackdrop} onClick={() => setShowUserMenu(false)} />
                <div style={styles.userMenuPopover} onClick={(e) => e.stopPropagation()}>
                  <div style={styles.userMenuHeader}>
                    <div style={{ ...styles.avatar, width: 34, height: 34, background: hashToShade(userName), fontSize: 13 }}>
                      {initials(userName)}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {userName}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                        {workspace?.type === "project" ? "Team Member" : "Personal Space"}
                      </div>
                    </div>
                  </div>

                  <div style={styles.userMenuDivider} />

                  <div style={styles.userMenuItemStatic}>
                    <span
                      style={{
                        ...styles.statusDot,
                        background: serverStatus === "online" ? "#5FAE84" : serverStatus === "offline" ? "var(--danger)" : "#C7B36A",
                      }}
                    />
                    <span style={{ fontSize: 12.5, color: "var(--ink-soft)", flex: 1 }}>
                      {serverStatus === "online" ? "Server connected" : serverStatus === "offline" ? "Server offline" : "Connecting…"}
                    </span>
                  </div>

                  <button
                    type="button"
                    style={styles.userMenuItem}
                    onClick={() => {
                      toggleTheme();
                    }}
                  >
                    <span style={{ fontSize: 15 }}>{theme === "dark" ? "☀️" : "🌙"}</span>
                    <span style={{ flex: 1, textAlign: "left", fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                      {theme === "dark" ? "Light Mode" : "Dark Mode"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--ink-soft)", textTransform: "capitalize" }}>
                      {theme}
                    </span>
                  </button>

                  {workspace?.type === "project" && (
                    <button
                      type="button"
                      style={styles.userMenuItem}
                      onClick={() => {
                        setShowUserMenu(false);
                        setShowInvite(true);
                      }}
                    >
                      <span style={{ fontSize: 15 }}>🔗</span>
                      <span style={{ flex: 1, textAlign: "left", fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                        Invite Teammates
                      </span>
                    </button>
                  )}

                  <div style={styles.userMenuDivider} />

                  <button
                    type="button"
                    style={{ ...styles.userMenuItem, color: "var(--danger)" }}
                    onClick={() => {
                      setShowUserMenu(false);
                      setShowSignOutConfirm(true);
                    }}
                  >
                    <span style={{ fontSize: 15 }}>↪</span>
                    <span style={{ flex: 1, textAlign: "left", fontSize: 13, fontWeight: 600, color: "var(--danger)" }}>
                      Sign out
                    </span>
                  </button>
                </div>
              </>
            )}

            <button
              type="button"
              style={{
                ...styles.userProfileBtn,
                ...(showUserMenu ? styles.userProfileBtnActive : {}),
              }}
              onClick={() => setShowUserMenu((v) => !v)}
              title="Account & settings"
            >
              <div style={{ ...styles.avatar, width: 32, height: 32, background: hashToShade(userName), fontSize: 12 }}>
                {initials(userName)}
              </div>
              <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {userName}
                </div>
              </div>
              <span style={{ fontSize: 10, color: "var(--ink-soft)", transition: "transform 0.2s", transform: showUserMenu ? "rotate(180deg)" : "none" }}>
                ▲
              </span>
            </button>
          </div>

          {contextMenu && (
            <>
              <div
                style={styles.contextMenuBackdrop}
                onClick={() => setContextMenu(null)}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
              />
              <div
                style={{
                  ...styles.contextMenuPopover,
                  top: contextMenu.y,
                  left: contextMenu.x,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={styles.contextMenuHeader}>
                  {contextMenu.name}
                </div>
                <div style={styles.userMenuDivider} />
                <button
                  type="button"
                  style={styles.contextMenuItem}
                  onClick={() => shareRecentChat(contextMenu)}
                >
                  <span style={{ fontSize: 14 }}>🔗</span>
                  <span>Share Link</span>
                </button>
                <button
                  type="button"
                  style={styles.contextMenuItem}
                  onClick={() => {
                    setRenamingId(contextMenu.id);
                    setRenameDraft(contextMenu.name);
                    setContextMenu(null);
                  }}
                >
                  <span style={{ fontSize: 14 }}>✏️</span>
                  <span>Rename</span>
                </button>
                <div style={styles.userMenuDivider} />
                <button
                  type="button"
                  style={{ ...styles.contextMenuItem, color: "var(--danger)" }}
                  onClick={() => deleteRecentChat(contextMenu.id)}
                >
                  <span style={{ fontSize: 14 }}>🗑️</span>
                  <span style={{ fontWeight: 600 }}>Delete Chat</span>
                </button>
              </div>
            </>
          )}

          {shareToast && (
            <div style={styles.toastNotification}>
              ✓ {shareToast}
            </div>
          )}

          {showSignOutConfirm && (
            <div style={styles.modalOverlay} onClick={() => setShowSignOutConfirm(false)}>
              <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                <h3 style={styles.modalTitle}>Sign out?</h3>
                <p style={styles.modalDesc}>You'll need to log in again with your username and password to get back in.</p>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    style={{ ...styles.modalCloseBtn, marginTop: 0, flex: 1 }}
                    onClick={() => setShowSignOutConfirm(false)}
                  >
                    No, stay
                  </button>
                  <button
                    style={{ ...styles.modalCopyBtn, flex: 1, background: "var(--danger)" }}
                    onClick={() => {
                      setShowSignOutConfirm(false);
                      signOut();
                    }}
                  >
                    Yes, sign out
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* ===== Main chat ===== */}
        <main style={styles.main}>
          <header className="header-responsive" style={styles.header}>
            <div style={styles.headerContent}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                {sidebarCollapsed && (
                  <button
                    type="button"
                    style={styles.expandToggleBtn}
                    onClick={() => setSidebarCollapsed(false)}
                    title="Expand sidebar"
                    aria-label="Expand sidebar"
                  >
                    »
                  </button>
                )}
                <button
                  type="button"
                  className="mobile-only"
                  style={styles.mobileMenuBtn}
                  onClick={() => setSidebarOpen((v) => !v)}
                  title="Toggle menu"
                  aria-label="Toggle menu"
                >
                  ☰
                </button>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={styles.headerTitleRow}>
                    <h2 style={styles.headerTitle} className="brand-font">{workspace.name}</h2>
                    <span style={{ ...styles.typeBadge, ...(workspace.type === "project" ? styles.typeBadgeProject : styles.typeBadgePersonal) }}>
                      {workspace.type === "project" ? "Project" : "Personal"}
                    </span>
                  </div>
                  <p style={styles.headerSubtitle}>
                    {workspace.type === "project"
                      ? (activeThread?.isBranch
                        ? `Your branch of ${activeThread.parentOwnerName}'s chat (private to you and them)`
                        : activeThread && activeThread.owner_id !== userId
                          ? `Viewing ${activeThread.owner_name}'s chat.`
                          : "Ask for a document, upload a file, or just talk it through.")
                      : "Your private space with NexaAI."}
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <button
                  style={styles.branchHeaderBtn}
                  onClick={() => createBranchFromCurrent()}
                  title="Create a new branch / fork of this conversation"
                  disabled={isBranching}
                >
                  🌿 <span className="desktop-only" style={{ marginLeft: 3 }}>Create Branch</span>
                </button>
                {workspace.type === "project" && (
                  <button style={styles.inviteHeaderBtn} onClick={() => setShowInvite(true)}>
                    🔗 <span className="desktop-only" style={{ marginLeft: 3 }}>Invite</span>
                  </button>
                )}
                <button
                  style={styles.themeToggleBtn}
                  onClick={toggleTheme}
                  title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
                  aria-label="Toggle theme"
                >
                  {theme === "dark" ? "☀️" : "🌙"}
                </button>
              </div>
            </div>
          </header>
          {(isLoading || isTranscribing || historyLoading || isBranching) && (
            <div className="chat-progress-track">
              <div className="progress-bar-fill" />
            </div>
          )}

          {workspace.type === "project" && activeThread && activeThread.owner_id !== userId && !activeThread.isBranch && (
            <div style={styles.branchBanner}>
              👀 Viewing <strong>{activeThread.owner_name}</strong>'s chat. Anything you send here starts your own private branch, {activeThread.owner_name}'s chat stays untouched.
            </div>
          )}
          {activeThread?.isBranch && (
            <div style={styles.branchBanner}>
              🌿 This is your branch of <strong>{activeThread.parentOwnerName || "main"}</strong>'s chat, continued from where it was left.
            </div>
          )}

          <div className="chat-area-responsive" style={styles.chatArea}>
            {(historyLoading || isBranching) && messages.length === 0 && (
              <div style={styles.emptyState}>
                <div style={styles.emptyOrb}>⏳</div>
                <p style={styles.emptyTitle}>Loading conversation…</p>
              </div>
            )}

            {!historyLoading && messages.length === 0 && (
              <div className="quick-start-container">
                <div style={{ fontSize: 34, marginBottom: 8 }}>✨</div>
                <h2 className="quick-start-greeting brand-font">Welcome, {userName || "there"}! 👋</h2>
                <p className="quick-start-sub">
                  NexaAI answers questions directly in chat. Documents & spreadsheets are generated <strong>only when requested</strong> with one-click download buttons.
                </p>
                <div className="quick-start-grid">
                  <div className="quick-start-card" onClick={() => sendMessage("What is the current weather in London?")}>
                    <span className="quick-start-card-icon">⛅</span>
                    <div>
                      <div className="quick-start-card-title">Live Weather</div>
                      <div className="quick-start-card-prompt">"What is the current weather in London?"</div>
                    </div>
                  </div>
                  <div className="quick-start-card" onClick={() => sendMessage("Create a detailed PDF report on Renewable Energy and its future")}>
                    <span className="quick-start-card-icon">📄</span>
                    <div>
                      <div className="quick-start-card-title">Generate PDF Document</div>
                      <div className="quick-start-card-prompt">"Create a PDF report on Renewable Energy"</div>
                    </div>
                  </div>
                  <div className="quick-start-card" onClick={() => sendMessage("Write a professional project proposal in a Word document")}>
                    <span className="quick-start-card-icon">📝</span>
                    <div>
                      <div className="quick-start-card-title">Create Word Document</div>
                      <div className="quick-start-card-prompt">"Draft a project proposal document"</div>
                    </div>
                  </div>
                  <div className="quick-start-card" onClick={() => sendMessage("Create a monthly household budget spreadsheet in Excel")}>
                    <span className="quick-start-card-icon">📊</span>
                    <div>
                      <div className="quick-start-card-title">Create Excel Spreadsheet</div>
                      <div className="quick-start-card-prompt">"Build a monthly budget spreadsheet"</div>
                    </div>
                  </div>
                  <div className="quick-start-card" onClick={() => sendMessage("Search latest technology and artificial intelligence news")}>
                    <span className="quick-start-card-icon">🔍</span>
                    <div>
                      <div className="quick-start-card-title">Live Internet Search</div>
                      <div className="quick-start-card-prompt">"Latest tech and AI news search"</div>
                    </div>
                  </div>
                  <div className="quick-start-card" onClick={() => sendMessage("Explain the differences between FastAPI and Next.js")}>
                    <span className="quick-start-card-icon">💡</span>
                    <div>
                      <div className="quick-start-card-title">General Chat / Coding</div>
                      <div className="quick-start-card-prompt">"FastAPI vs Next.js comparison"</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {(() => {
              const displayed = [];
              const seenIds = new Set();
              for (let i = 0; i < messages.length; i++) {
                const m = messages[i];
                if (m.id) {
                  if (seenIds.has(m.id)) continue;
                  seenIds.add(m.id);
                }
                if (m.role === "ai" && displayed.length > 0) {
                  const prev = displayed[displayed.length - 1];
                  if (
                    prev.role === "ai" &&
                    prev.content &&
                    m.content &&
                    prev.content.trim() === m.content.trim()
                  ) {
                    continue;
                  }
                }
                displayed.push(m);
              }

              return displayed.map((msg, idx) => {
                const isUser = msg.role === "user";
                const isSystem = msg.user_name === "System";
                const displayName = isUser ? (msg.user_name || "You") : (isSystem ? "System" : "NexaAI");
                const shade = isUser ? hashToShade(displayName) : "var(--ai-bubble)";
                const isInherited = activeThread?.isBranch && idx < inheritedCount;
                const isBranchStart = activeThread?.isBranch && inheritedCount > 0 && idx === inheritedCount;
                return (
                  <React.Fragment key={msg.id || idx}>
                    {isBranchStart && (
                      <div style={styles.branchDivider}>
                        <span>🌿 Branched here by {userName}</span>
                      </div>
                    )}
                    <div
                      style={{
                        ...styles.messageRow,
                        justifyContent: isUser ? "flex-end" : "flex-start",
                        animation: "slideIn 0.25s ease both",
                        opacity: isInherited ? 0.6 : 1,
                      }}
                    >
                      {!isUser && (
                        <div style={{ ...styles.msgAvatar, background: isSystem ? "var(--danger)" : "var(--accent)" }}>
                          {isSystem ? "!" : "NX"}
                        </div>
                      )}
                      <div className="bubble-container-responsive" style={{ maxWidth: "72%" }}>
                        <div style={{
                          ...styles.bubbleMeta,
                          justifyContent: isUser ? "flex-end" : "flex-start",
                        }}>
                          <span style={styles.bubbleName}>{displayName}</span>
                          {msg.created_at && <span style={styles.bubbleTime}>{formatTime(msg.created_at)}</span>}
                          {!isInherited && (
                            <button
                              type="button"
                              style={styles.replyBtn}
                              title="Reply"
                              onClick={() => setReplyingTo({ id: msg.id, user_name: displayName, content: msg.content })}
                            >
                              ↩ Reply
                            </button>
                          )}
                          <button
                            type="button"
                            style={styles.branchMsgBtn}
                            title="Branch conversation from here"
                            onClick={() => createBranchFromCurrent(msg.id)}
                          >
                            🌿 Branch
                          </button>
                        </div>
                        <div
                          style={{
                            ...styles.bubble,
                            background: isUser ? shade : (isSystem ? "#FBEAE7" : "var(--ai-bubble)"),
                            color: isUser ? "#fff" : "var(--ink)",
                            borderBottomRightRadius: isUser ? 4 : 16,
                            borderBottomLeftRadius: isUser ? 16 : 4,
                          }}
                        >
                          {msg.reply_to_content && (
                            <div
                              style={{
                                ...styles.replyQuote,
                                borderLeftColor: isUser ? "rgba(255,255,255,0.6)" : "var(--navy)",
                                background: isUser ? "rgba(255,255,255,0.14)" : "rgba(34,48,63,0.06)",
                              }}
                            >
                              <div style={{ fontWeight: 700, opacity: 0.9 }}>{msg.reply_to_user_name}</div>
                              <div style={{ opacity: 0.8 }}>
                                {msg.reply_to_content.length > 120
                                  ? msg.reply_to_content.slice(0, 120) + "…"
                                  : msg.reply_to_content}
                              </div>
                            </div>
                          )}
                          <MessageContent
                            content={msg.content}
                            isUser={isUser}
                            onCopy={copyToClipboard}
                          />
                        </div>
                      </div>
                      {isUser && (
                        <div style={{ ...styles.msgAvatar, background: shade }}>
                          {initials(displayName)}
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                );
              });
            })()}

            {isLoading && (
              <div style={{ ...styles.messageRow, justifyContent: "flex-start" }}>
                <div style={{ ...styles.msgAvatar, background: "var(--accent)" }}>NX</div>
                <div style={{ ...styles.bubble, background: "var(--ai-bubble)", display: "flex", gap: 5, padding: "14px 18px" }}>
                  <span style={{ ...styles.typingDot, animationDelay: "0s" }} />
                  <span style={{ ...styles.typingDot, animationDelay: "0.15s" }} />
                  <span style={{ ...styles.typingDot, animationDelay: "0.3s" }} />
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* ===== Composer ===== */}
          <div className="composer-wrap-responsive" style={styles.composerWrap}>
            {isRecording && (
              <div style={styles.listeningChip}>
                <span style={styles.recordingDot} />
                <span>{liveCaption ? liveCaption : "Listening…"}</span>
              </div>
            )}
            {voiceNotice && (
              <div style={styles.noticeChip}>
                <span>🎤 {voiceNotice}</span>
                <button style={styles.attachmentRemove} onClick={() => setVoiceNotice("")}>✕</button>
              </div>
            )}
            {selectedFile && (
              <div style={styles.attachmentChip}>
                <span>📎 {selectedFile.name}</span>
                <button style={styles.attachmentRemove} onClick={() => setSelectedFile(null)}>✕</button>
              </div>
            )}
            {replyingTo && (
              <div style={styles.attachmentChip}>
                <span>
                  ↩ Replying to <strong>{replyingTo.user_name}</strong>:{" "}
                  {replyingTo.content?.length > 80 ? replyingTo.content.slice(0, 80) + "…" : replyingTo.content}
                </span>
                <button style={styles.attachmentRemove} onClick={() => setReplyingTo(null)}>✕</button>
              </div>
            )}
            <div style={styles.composer}>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: "none" }}
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
              <button
                style={styles.iconButton}
                onClick={() => fileInputRef.current?.click()}
                title="Attach a file"
                type="button"
              >
                📎
              </button>
              <button
                style={{
                  ...styles.iconButton,
                  ...(isRecording ? styles.iconButtonActive : {}),
                  opacity: isTranscribing ? 0.6 : 1,
                }}
                onClick={handleVoiceRecording}
                title={isRecording ? "Stop recording" : "Voice input"}
                type="button"
                disabled={isTranscribing}
              >
                {isTranscribing ? <span style={styles.spinnerDark} /> : (isRecording ? "⏹️" : "🎤")}
              </button>
              <textarea
                ref={textareaRef}
                rows={1}
                style={styles.textarea}
                placeholder="Message NexaAI…"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
              />
              <button
                style={{
                  ...styles.sendButton,
                  opacity: (!inputText.trim() && !selectedFile) || isLoading ? 0.5 : 1,
                }}
                onClick={sendMessage}
                disabled={(!inputText.trim() && !selectedFile) || isLoading}
                type="button"
              >
                {isLoading ? <span style={styles.spinner} /> : "Send"}
              </button>
            </div>
          </div>
        </main>

        {/* ===== Drag overlay ===== */}
        {isDragging && (
          <div style={styles.dropOverlay}>
            <div style={styles.dropCard}>
              <div style={{ fontSize: 40 }}>📥</div>
              <p style={{ margin: "8px 0 0", fontWeight: 600 }}>Drop the file to attach it</p>
            </div>
          </div>
        )}

        {/* ===== Invite modal ===== */}
        {showInvite && workspace.type === "project" && (
          <div style={styles.modalOverlay} onClick={() => setShowInvite(false)}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <h3 style={styles.modalTitle}>Invite to "{workspace.name}"</h3>
              <p style={styles.modalDesc}>Share either the link or the ID. Teammates just need one.</p>

              <div style={styles.modalFieldLabel}>Invite link</div>
              <div style={styles.modalRow}>
                <input readOnly style={styles.modalInput} value={inviteLink} onFocus={(e) => e.target.select()} />
                <button style={styles.modalCopyBtn} onClick={() => copyToClipboard(inviteLink, "link")}>
                  {copiedField === "link" ? "Copied ✓" : "Copy"}
                </button>
              </div>

              <div style={styles.modalFieldLabel}>Workspace ID</div>
              <div style={styles.modalRow}>
                <input readOnly style={styles.modalInput} value={workspace.id} onFocus={(e) => e.target.select()} />
                <button style={styles.modalCopyBtn} onClick={() => copyToClipboard(workspace.id, "id")}>
                  {copiedField === "id" ? "Copied ✓" : "Copy"}
                </button>
              </div>

              <button style={styles.modalCloseBtn} onClick={() => setShowInvite(false)}>Done</button>
            </div>
          </div>
        )}

        {shareToast && (
          <div style={styles.toast}>
            {shareToast}
          </div>
        )}
      </div>
    </>
  );
}

const styles = {
  joinScreen: {
    height: "100%",
    height: "100dvh",
    width: "100%",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    background: "var(--bg-light)",
    padding: "48px 16px 36px",
    position: "relative",
  },
  joinCard: {
    background: "var(--white)",
    borderRadius: "var(--radius-lg)",
    padding: "36px 30px",
    width: "100%",
    maxWidth: 440,
    boxShadow: "var(--shadow-lg)",
    textAlign: "center",
    position: "relative",
    margin: "auto",
    flexShrink: 0,
  },
  joinSubtitle: {
    margin: "0 0 28px",
    color: "var(--ink-soft)",
    fontSize: 14.5,
    lineHeight: 1.5,
    position: "relative",
  },
  joinInput: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: "var(--radius-sm)",
    border: "1.5px solid var(--navy-tint-18)",
    fontSize: 14.5,
    marginBottom: 12,
    outline: "none",
    background: "var(--bg-light)",
    color: "var(--ink)",
    fontFamily: "inherit",
  },
  passwordToggle: {
    position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
    marginTop: -7, border: "none", background: "transparent", fontSize: 16,
    padding: 6, lineHeight: 1, cursor: "pointer", opacity: 0.75,
  },
  joinButton: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "var(--navy)",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    boxShadow: "var(--shadow-md)",
  },
  linkButton: {
    width: "100%",
    padding: "12px 16px",
    marginTop: 10,
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "transparent",
    color: "var(--ink-soft)",
    fontSize: 13.5,
    fontWeight: 600,
  },
  errorText: {
    color: "var(--danger)",
    fontSize: 12.5,
    margin: "-8px 0 12px",
    textAlign: "left",
  },

  modeGrid: { display: "flex", flexDirection: "column", gap: 12, position: "relative" },
  modeCard: {
    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4,
    width: "100%", textAlign: "left", padding: "16px 18px",
    borderRadius: "var(--radius-md)", border: "1.5px solid var(--navy-tint-18)",
    background: "var(--bg-light)", transition: "transform 0.15s, box-shadow 0.15s",
  },
  modeIcon: { fontSize: 22, marginBottom: 2 },
  modeTitle: { fontSize: 15, fontWeight: 700, color: "var(--ink)" },
  modeDesc: { fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.4 },

  recentList: { display: "flex", flexDirection: "column", gap: 6 },
  recentRow: {
    display: "flex", alignItems: "center", gap: 10, width: "100%",
    padding: "9px 10px", borderRadius: "var(--radius-sm)", border: "none",
    background: "var(--bg-light)", textAlign: "left",
  },
  recentIcon: {
    width: 30, height: 30, borderRadius: 9, display: "flex", alignItems: "center",
    justifyContent: "center", fontSize: 14, flexShrink: 0,
  },
  recentInfo: { display: "flex", flexDirection: "column", overflow: "hidden" },
  recentName: { fontSize: 13, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  recentSub: { fontSize: 11, color: "var(--ink-soft)" },

  app: {
    display: "flex",
    height: "100%",
    height: "100dvh",
    width: "100%",
    background: "var(--bg-light)",
    position: "relative",
    overflow: "hidden",
  },

  sidebar: {
    width: 280,
    flexShrink: 0,
    height: "100%",
    height: "100dvh",
    maxHeight: "100dvh",
    background: "var(--white)",
    borderRight: "1px solid var(--navy-tint-08)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    padding: "16px 14px",
    position: "relative",
  },
  sidebarTopFixed: {
    flexShrink: 0,
    paddingBottom: 4,
  },
  sidebarScrollableContent: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    paddingRight: 4,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    margin: "8px 0",
  },
  collapseToggleBtn: {
    width: 28,
    height: 28,
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--navy-tint-18)",
    background: "var(--bg-light)",
    color: "var(--ink)",
    fontSize: 16,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    lineHeight: 1,
    padding: 0,
    transition: "background 0.15s, color 0.15s",
  },
  expandToggleBtn: {
    width: 32,
    height: 32,
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--navy-tint-18)",
    background: "var(--white)",
    color: "var(--ink)",
    fontSize: 18,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    lineHeight: 1,
    flexShrink: 0,
    boxShadow: "var(--shadow-sm)",
    padding: 0,
    transition: "background 0.15s, color 0.15s",
  },
  actionButtonsStack: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 12,
  },
  sidebarActionBtnPrimary: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "9px 12px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--navy-tint-18)",
    background: "var(--navy)",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "background 0.15s, transform 0.1s",
    textAlign: "left",
  },
  sidebarActionBtnSecondary: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "7px 12px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--navy-tint-12)",
    background: "var(--bg-light)",
    color: "var(--ink)",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
    textAlign: "left",
  },
  sidebarBottomFixed: {
    flexShrink: 0,
    position: "relative",
    paddingTop: 10,
    borderTop: "1px solid var(--navy-tint-08)",
    marginTop: "auto",
  },
  brandRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16 },
  brandMark: {
    width: 38, height: 38, borderRadius: 11,
    background: "var(--navy)",
    color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 800, fontSize: 14, flexShrink: 0,
  },
  brandName: { fontWeight: 700, fontSize: 15.5, color: "var(--ink)" },
  brandSub: { fontSize: 12, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },

  newRow: { display: "flex", gap: 8, marginBottom: 4 },
  newBtn: {
    flex: 1, padding: "9px 10px", borderRadius: "var(--radius-sm)",
    border: "1px solid var(--navy-tint-18)", background: "var(--bg-light)",
    color: "var(--navy)", fontSize: 12.5, fontWeight: 700,
  },

  sidebarSection: { marginBottom: 0 },
  sidebarLabel: {
    fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
    color: "var(--ink-soft)", marginBottom: 10,
  },
  memberList: { display: "flex", flexDirection: "column", gap: 8 },
  memberRow: { display: "flex", alignItems: "center", gap: 10 },
  avatar: {
    width: 30, height: 30, borderRadius: "50%", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 11.5, fontWeight: 700, flexShrink: 0,
  },
  memberName: { fontSize: 13.5, color: "var(--ink)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  youTag: { fontSize: 10.5, color: "var(--ink-soft)", fontWeight: 500 },
  onlineDot: { width: 7, height: 7, borderRadius: "50%", background: "#5FAE84", flexShrink: 0 },

  recentListCompact: { display: "flex", flexDirection: "column", gap: 4 },
  recentRowCompact: {
    display: "flex", alignItems: "center", gap: 9, width: "100%",
    padding: "7px 8px", borderRadius: "var(--radius-sm)", border: "none",
    background: "transparent", textAlign: "left", cursor: "pointer",
    userSelect: "none",
  },
  recentRowActive: { background: "var(--navy-tint-08)" },
  recentIconSm: { fontSize: 13, flexShrink: 0, cursor: "pointer", userSelect: "none" },
  recentNameSm: { fontSize: 12.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" },

  projectNestedContainer: {
    marginLeft: 12,
    paddingLeft: 8,
    borderLeft: "2px solid var(--navy-tint-18)",
    display: "flex",
    flexDirection: "column",
    gap: 2,
    marginTop: 3,
    marginBottom: 6,
  },
  recentRowNested: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "5px 7px",
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "transparent",
    color: "var(--ink)",
    fontSize: 12,
    cursor: "pointer",
    width: "100%",
    textAlign: "left",
    transition: "background 0.15s ease",
  },
  recentRowNestedActive: {
    background: "var(--navy-tint-12)",
    fontWeight: 600,
  },

  filesList: { overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 6, paddingRight: 2 },
  filesEmpty: { fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.5, padding: "6px 2px" },
  fileRow: {
    display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
    borderRadius: "var(--radius-sm)", textDecoration: "none", color: "inherit",
    background: "var(--bg-light)", transition: "background 0.15s",
  },
  fileIcon: { fontSize: 17, flexShrink: 0 },
  fileInfo: { display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 },
  fileName: { fontSize: 12.5, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  fileSub: { fontSize: 11, color: "var(--ink-soft)" },
  fileDownload: { fontSize: 14, color: "var(--navy)", flexShrink: 0 },

  statusRow: { display: "flex", alignItems: "center", gap: 8, paddingTop: 14, borderTop: "1px solid var(--navy-tint-08)" },
  statusDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  statusText: { fontSize: 12, color: "var(--ink-soft)" },
  signOutBtn: {
    marginTop: 10, padding: "9px 12px", borderRadius: "var(--radius-sm)",
    border: "1px solid var(--navy-tint-18)", background: "transparent",
    color: "var(--ink-soft)", fontSize: 12.5, fontWeight: 600, textAlign: "left",
    cursor: "pointer",
  },

  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    maxHeight: "100dvh",
    overflow: "hidden",
    position: "relative",
  },

  header: {
    position: "relative",
    flexShrink: 0,
    padding: "16px 24px",
    background: "var(--white)",
    borderBottom: "1px solid var(--navy-tint-08)",
    zIndex: 10,
  },
  headerGlow: {
    position: "absolute", top: -80, left: "30%", width: 260, height: 260, borderRadius: "50%",
    background: "radial-gradient(circle, var(--accent-tint-25) 0%, transparent 70%)",
    animation: "drift 10s ease-in-out infinite", pointerEvents: "none",
  },
  headerContent: { position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 },
  headerTitleRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  headerTitle: { margin: 0, fontSize: 20, fontWeight: 700, color: "var(--ink)" },
  headerSubtitle: { margin: "4px 0 0", fontSize: 13, color: "var(--ink-soft)" },
  typeBadge: { fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20, letterSpacing: 0.3 },
  typeBadgeProject: { background: "var(--accent-tint-25)", color: "var(--navy-dark)" },
  typeBadgePersonal: { background: "var(--navy-tint-12)", color: "var(--navy)" },
  inviteHeaderBtn: {
    flexShrink: 0, padding: "9px 16px", borderRadius: 20, border: "1px solid var(--navy-tint-18)",
    background: "var(--bg-light)", color: "var(--navy)", fontSize: 12.5, fontWeight: 700,
  },
  branchHeaderBtn: {
    flexShrink: 0, padding: "8px 15px", borderRadius: 20, border: "1px solid var(--navy-tint-18)",
    background: "var(--bg-light)", color: "var(--navy)", fontSize: 12.5, fontWeight: 700,
    cursor: "pointer", display: "flex", alignItems: "center", gap: 4, transition: "background 0.15s, transform 0.1s",
  },
  notifBadge: {
    position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8,
    background: "var(--danger)", color: "#fff", fontSize: 10, fontWeight: 700,
    display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
  },
  notifDropdown: {
    position: "absolute", top: "calc(100% + 8px)", right: 0, width: 300, maxHeight: 320,
    overflowY: "auto", background: "var(--white)", borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-lg)", border: "1px solid var(--navy-tint-08)", zIndex: 30, padding: 8,
  },
  notifItem: {
    display: "block", width: "100%", textAlign: "left", padding: "10px 10px", borderRadius: "var(--radius-sm)",
    border: "none", background: "transparent", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.4,
  },
  notifItemUnread: { background: "var(--navy-tint-08)", color: "var(--ink)", fontWeight: 600 },
  branchBanner: {
    padding: "10px 32px", background: "var(--accent-tint-25)", color: "var(--navy-dark)",
    fontSize: 12.5, lineHeight: 1.5, borderBottom: "1px solid var(--navy-tint-08)",
  },

  chatArea: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },

  emptyState: { margin: "auto", textAlign: "center", color: "var(--ink-soft)", maxWidth: 320 },
  emptyOrb: {
    width: 56, height: 56, borderRadius: "50%", background: "var(--ai-bubble)",
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
    margin: "0 auto 14px",
  },
  emptyTitle: { margin: "0 0 4px", fontWeight: 700, color: "var(--ink)", fontSize: 15 },
  emptySubtitle: { margin: 0, fontSize: 13, lineHeight: 1.5 },

  branchDivider: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    fontSize: 11.5, fontWeight: 700, color: "var(--navy)", margin: "6px 0",
    textAlign: "center",
  },
  messageRow: { display: "flex", alignItems: "flex-end", gap: 10 },
  msgAvatar: {
    width: 30, height: 30, borderRadius: "50%", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 11, fontWeight: 700, flexShrink: 0, marginBottom: 20,
  },
  bubbleMeta: { display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4, padding: "0 4px" },
  bubbleName: { fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" },
  bubbleTime: { fontSize: 10.5, color: "var(--ink-soft)", opacity: 0.7 },
  replyBtn: {
    border: "none", background: "transparent", color: "var(--ink-soft)",
    fontSize: 10.5, fontWeight: 700, cursor: "pointer", opacity: 0.65, padding: "0 2px",
  },
  branchMsgBtn: {
    border: "none", background: "transparent", color: "var(--navy)",
    fontSize: 10.5, fontWeight: 700, cursor: "pointer", opacity: 0.75, padding: "0 2px",
    display: "inline-flex", alignItems: "center", gap: 2,
  },
  toast: {
    position: "fixed", bottom: 24, right: 24, background: "var(--navy)",
    color: "#fff", padding: "10px 18px", borderRadius: "var(--radius-sm)",
    fontSize: 13.5, fontWeight: 600, boxShadow: "var(--shadow-lg)", zIndex: 9999,
  },
  replyQuote: {
    borderLeft: "3px solid", borderRadius: 6, padding: "6px 10px", marginBottom: 8,
    fontSize: 12.5, lineHeight: 1.4,
  },
  bubble: {
    padding: "12px 16px", borderRadius: 16, fontSize: 14.5, lineHeight: 1.55,
    whiteSpace: "pre-wrap", wordBreak: "break-word", boxShadow: "var(--shadow-sm)",
  },
  typingDot: {
    width: 7, height: 7, borderRadius: "50%", background: "var(--navy)",
    display: "inline-block", animation: "typingDot 1.1s infinite ease-in-out",
  },

  composerWrap: { padding: "14px 32px 22px", background: "var(--bg-light)" },
  attachmentChip: {
    display: "inline-flex", alignItems: "center", gap: 8, background: "var(--white)",
    border: "1px solid var(--navy-tint-18)", borderRadius: 20, padding: "6px 12px",
    fontSize: 12.5, color: "var(--ink)", maxWidth: 680, width: "fit-content", margin: "0 auto 8px", boxShadow: "var(--shadow-sm)",
  },
  noticeChip: {
    display: "inline-flex", alignItems: "center", gap: 8, background: "#FBEAE7",
    border: "1px solid rgba(196,104,91,0.3)", borderRadius: 20, padding: "6px 12px",
    fontSize: 12.5, color: "var(--danger)", marginBottom: 8,
  },
  listeningChip: {
    display: "inline-flex", alignItems: "center", gap: 8, background: "var(--navy-tint-12)",
    border: "1px solid var(--navy-tint-18)", borderRadius: 20, padding: "6px 12px",
    fontSize: 12.5, color: "var(--navy)", marginBottom: 8, maxWidth: "100%",
  },
  recordingDot: {
    width: 8, height: 8, borderRadius: "50%", background: "var(--danger)",
    flexShrink: 0, animation: "typingDot 1.1s infinite ease-in-out",
  },
  attachmentRemove: { border: "none", background: "none", color: "var(--ink-soft)", fontSize: 12, padding: 0, lineHeight: 1 },

  composer: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    background: "var(--white)",
    borderRadius: 26,
    padding: "7px 12px",
    boxShadow: "var(--shadow-md)",
    border: "1.5px solid var(--navy-tint-18)",
    width: "100%",
    maxWidth: 680,
    margin: "0 auto",
  },
  iconButton: {
    width: 40, height: 40, borderRadius: "50%", border: "none",
    background: "var(--bg-light)", fontSize: 16, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "background 0.15s",
  },
  iconButtonActive: { background: "var(--navy)", animation: "pulseRing 1.5s infinite" },
  textarea: {
    flex: 1, border: "none", outline: "none", resize: "none",
    background: "transparent", fontSize: 14.5, lineHeight: 1.5,
    padding: "9px 6px", maxHeight: 160, color: "var(--ink)",
  },
  sendButton: {
    height: 40, padding: "0 20px", borderRadius: 20, border: "none",
    background: "var(--navy)", color: "#fff", fontWeight: 600, fontSize: 14,
    flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
  },
  spinner: {
    width: 15, height: 15, border: "2px solid rgba(255,255,255,0.4)",
    borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite",
  },
  spinnerDark: {
    width: 15, height: 15, border: "2px solid var(--navy-tint-18)",
    borderTopColor: "var(--navy)", borderRadius: "50%", animation: "spin 0.7s linear infinite",
  },

  dropOverlay: {
    position: "absolute", inset: 0, background: "rgba(74, 111, 165, 0.18)",
    backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 20, animation: "fadeIn 0.15s ease",
  },
  dropCard: {
    background: "var(--white)", borderRadius: "var(--radius-lg)", padding: "32px 48px",
    textAlign: "center", boxShadow: "var(--shadow-lg)", border: "2px dashed var(--navy)",
  },

  modalOverlay: {
    position: "fixed", inset: 0, background: "rgba(34, 48, 63, 0.35)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 40, animation: "fadeIn 0.15s ease", padding: 20,
  },
  modalCard: {
    background: "var(--white)", borderRadius: "var(--radius-lg)", padding: "28px 26px",
    width: "100%", maxWidth: 440, boxShadow: "var(--shadow-lg)",
  },
  modalTitle: { margin: "0 0 4px", fontSize: 17, fontWeight: 700, color: "var(--ink)" },
  modalDesc: { margin: "0 0 18px", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.5 },
  modalFieldLabel: { fontSize: 11.5, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 },
  modalRow: { display: "flex", gap: 8, marginBottom: 16 },
  modalInput: {
    flex: 1, padding: "10px 12px", borderRadius: "var(--radius-sm)",
    border: "1.5px solid var(--navy-tint-18)", background: "var(--bg-light)",
    fontSize: 12.5, color: "var(--ink)", outline: "none", minWidth: 0,
  },
  modalCopyBtn: {
    flexShrink: 0, padding: "0 16px", borderRadius: "var(--radius-sm)", border: "none",
    background: "var(--navy)", color: "#fff", fontSize: 12.5, fontWeight: 700,
  },
  modalCloseBtn: {
    width: "100%", padding: "12px 16px", marginTop: 6, borderRadius: "var(--radius-sm)",
    border: "1px solid var(--navy-tint-18)", background: "transparent",
    color: "var(--navy)", fontSize: 13.5, fontWeight: 700,
  },
  mobileMenuBtn: {
    width: 36,
    height: 36,
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--navy-tint-18)",
    background: "var(--bg-light)",
    color: "var(--ink)",
    fontSize: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
  },
  sidebarCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--navy-tint-18)",
    background: "transparent",
    color: "var(--ink-soft)",
    fontSize: 15,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
  },
  themeToggleBtn: {
    width: 38,
    height: 38,
    borderRadius: "50%",
    border: "1px solid var(--navy-tint-18)",
    background: "var(--bg-light)",
    color: "var(--ink)",
    fontSize: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "transform 0.15s ease, background 0.2s ease, box-shadow 0.2s ease",
    boxShadow: "var(--shadow-sm)",
    outline: "none",
    flexShrink: 0,
  },
  themeToggleFixed: {
    position: "fixed",
    top: 20,
    right: 20,
    width: 42,
    height: 42,
    borderRadius: "50%",
    border: "1px solid var(--navy-tint-18)",
    background: "var(--white)",
    color: "var(--ink)",
    fontSize: 19,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "transform 0.15s ease, background 0.2s ease, box-shadow 0.2s ease",
    boxShadow: "var(--shadow-md)",
    zIndex: 100,
    outline: "none",
  },
  userProfileBtn: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid transparent",
    background: "transparent",
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
  },
  userProfileBtnActive: {
    background: "var(--navy-tint-08)",
    borderColor: "var(--navy-tint-18)",
  },
  userMenuBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 90,
    background: "transparent",
  },
  userMenuPopover: {
    position: "absolute",
    bottom: "calc(100% + 8px)",
    left: 0,
    right: 0,
    background: "var(--white)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-lg)",
    border: "1px solid var(--navy-tint-18)",
    padding: "8px",
    zIndex: 95,
    animation: "slideIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  userMenuHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 8px 8px",
  },
  userMenuDivider: {
    height: 1,
    background: "var(--navy-tint-08)",
    margin: "4px 0",
  },
  userMenuItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    transition: "background 0.15s",
    textAlign: "left",
  },
  userMenuItemStatic: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 10px",
  },
  recentOptionsBtn: {
    border: "none",
    background: "transparent",
    color: "var(--ink-soft)",
    fontSize: 15,
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: 4,
    opacity: 0,
    transition: "opacity 0.15s, background 0.15s",
    lineHeight: 1,
    flexShrink: 0,
  },
  renameInput: {
    width: "100%",
    padding: "5px 8px",
    borderRadius: "var(--radius-sm)",
    border: "1.5px solid var(--navy)",
    background: "var(--bg-light)",
    color: "var(--ink)",
    fontSize: 12.5,
    fontWeight: 600,
    outline: "none",
    fontFamily: "inherit",
  },
  contextMenuBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    background: "transparent",
  },
  contextMenuPopover: {
    position: "fixed",
    zIndex: 210,
    width: 175,
    background: "var(--white)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-lg)",
    border: "1px solid var(--navy-tint-18)",
    padding: "6px",
    animation: "fadeIn 0.12s ease",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  contextMenuHeader: {
    fontSize: 11.5,
    fontWeight: 700,
    color: "var(--ink-soft)",
    padding: "4px 8px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  contextMenuItem: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    padding: "7px 8px",
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "transparent",
    color: "var(--ink)",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    textAlign: "left",
    transition: "background 0.12s",
  },
  toastNotification: {
    position: "fixed",
    bottom: 24,
    left: "50%",
    transform: "translateX(-50%)",
    background: "var(--navy)",
    color: "#ffffff",
    padding: "10px 20px",
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    boxShadow: "var(--shadow-lg)",
    zIndex: 300,
    animation: "slideIn 0.2s ease",
  },
};