import { GithubClient } from "../lib/github.mjs";

function http(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async text() {
      return JSON.stringify(body);
    },
  };
}

export const BOT_LOGIN = "factory[bot]";
export const IDENTITY = {
  kind: "github-app",
  botLogin: BOT_LOGIN,
  label: `github-app (${BOT_LOGIN})`,
};

export function gateGithub({
  pulls = {},
  comments = {},
  commits = {},
  checks = {},
  contents = {},
  files = {},
  combinedState = "success",
} = {}) {
  const state = {
    pulls: structuredClone(pulls),
    comments: structuredClone(comments),
    merges: [],
    closes: [],
  };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: pathname, body, url });
    const pullNumber = (pattern) => {
      const match = pathname.match(pattern);
      return match ? Number(match[1]) : null;
    };
    if (method === "PUT" && /\/pulls\/\d+\/merge$/.test(pathname)) {
      const number = pullNumber(/\/pulls\/(\d+)\/merge$/);
      state.merges.push({ number, body });
      const pull = state.pulls[number];
      if (pull) {
        pull.merged = true;
        pull.state = "closed";
        pull.merge_commit_sha = "m".repeat(40);
      }
      return http({ merged: true, sha: "m".repeat(40) });
    }
    if (method === "PATCH" && /\/pulls\/\d+$/.test(pathname)) {
      const number = pullNumber(/\/pulls\/(\d+)$/);
      state.closes.push(number);
      const pull = state.pulls[number];
      if (pull) pull.state = body.state;
      return http(pull ?? { state: body.state });
    }
    if (method === "POST" && /\/issues\/\d+\/comments$/.test(pathname)) {
      const number = pullNumber(/\/issues\/(\d+)\/comments$/);
      const comment = { id: (state.comments[number]?.length ?? 0) + 1, body: body.body, user: { login: BOT_LOGIN } };
      state.comments[number] = [...(state.comments[number] ?? []), comment];
      return http(comment);
    }
    if (method === "GET" && /\/pulls\/\d+\/reviews$/.test(pathname)) return http([]);
    if (method === "GET" && /\/pulls\/\d+\/comments$/.test(pathname)) return http([]);
    if (method === "GET" && /\/issues\/\d+\/comments$/.test(pathname)) {
      return http(state.comments[pullNumber(/\/issues\/(\d+)\/comments$/)] ?? []);
    }
    if (method === "GET" && /\/pulls\/\d+\/commits$/.test(pathname)) {
      return http(commits[pullNumber(/\/pulls\/(\d+)\/commits$/)] ?? []);
    }
    if (method === "GET" && /\/pulls\/\d+\/files$/.test(pathname)) {
      return http(files[pullNumber(/\/pulls\/(\d+)\/files$/)] ?? []);
    }
    if (method === "GET" && /\/commits\/[0-9a-f]+\/status$/.test(pathname)) return http({ state: combinedState });
    if (method === "GET" && /\/commits\/[0-9a-f]+\/check-runs$/.test(pathname)) {
      const sha = pathname.match(/\/commits\/([0-9a-f]+)\/check-runs$/)[1];
      return http({ check_runs: checks[sha] ?? [{ name: "check", status: "completed", conclusion: "success" }] });
    }
    if (method === "GET" && /\/commits\/[0-9a-f]+$/.test(pathname)) {
      const sha = pathname.match(/\/commits\/([0-9a-f]+)$/)[1];
      const commit = Object.values(commits).flat().find((item) => item.sha === sha);
      return http({ sha, files: commit?.files ?? [] });
    }
    if (method === "GET" && /\/pulls\/\d+$/.test(pathname)) {
      const pull = state.pulls[pullNumber(/\/pulls\/(\d+)$/)];
      if (!pull) return http({ message: "Not Found" }, 404);
      return http(pull);
    }
    if (method === "GET" && pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      const ref = parsed.searchParams.get("ref");
      const text = contents[`${ref}:${filePath}`];
      if (text == null) return http({ message: "Not Found" }, 404);
      return http({ encoding: "base64", content: Buffer.from(text).toString("base64"), type: "file" });
    }
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  const client = new GithubClient({ fetchImpl, token: "test-token", owner: "o", repo: "r", identity: IDENTITY });
  return { fetchImpl, state, calls, client };
}

export function pullFixture({ number, headSha, baseSha, state = "open", merged = false, body = "", mergeCommitSha = null, headRef = "tor/demo/stamp" }) {
  return {
    number,
    state,
    merged,
    merge_commit_sha: mergeCommitSha,
    html_url: `https://github.com/o/r/pull/${number}`,
    head: { sha: headSha, ref: headRef },
    base: { sha: baseSha },
    merged_by: null,
    body,
  };
}
