
const crypto = require("node:crypto");

const API_BASE = "https://api.netlify.com/api/v1";

function reply(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(data)
  };
}

function safeCompare(a, b) {
  const x = crypto.createHash("sha256")
    .update(a).digest();
  const y = crypto.createHash("sha256")
    .update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

async function netlifyGet(path, token) {
  const response = await fetch(API_BASE + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Netlify API: " + response.status);
  }

  return response.json();
}

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return reply(405, { error: "허용되지 않은 요청입니다." });
  }

  const password = process.env.ADMIN_PASSWORD;
  const token = process.env.NETLIFY_API_TOKEN;
  const siteId = process.env.TRAINING_SITE_ID;

  if (!password || !token || !siteId) {
    return reply(503, {
      error: "서버 환경변수가 설정되지 않았습니다."
    });
  }

  let input;

  try {
    input = JSON.parse(event.body || "{}");
  } catch {
    return reply(400, { error: "잘못된 요청입니다." });
  }

  if (typeof input.password !== "string" ||
      input.password.length > 256 ||
      !safeCompare(input.password, password)) {
    return reply(401, {
      error: "비밀번호가 올바르지 않습니다."
    });
  }

  try {
    const action = input.action || "list";
    if (action !== "list" && action !== "delete") {
      return reply(400, { error: "지원하지 않는 요청입니다." });
    }
    const forms = await netlifyGet(
      `/sites/${encodeURIComponent(siteId)}/forms`,
      token
    );

    const form = forms.find(
      item => item.name === "training-completions"
    );

    if (!form) {
      return reply(404, {
        error: "수료 기록 폼을 찾을 수 없습니다."
      });
    }

    const submissions = await netlifyGet(
      `/forms/${encodeURIComponent(form.id)}/submissions?per_page=100`,
      token
    );

    if (action === "delete") {
      const submissionId = input.submissionId;
      if (typeof submissionId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(submissionId)) {
        return reply(400, { error: "삭제할 기록 번호가 올바르지 않습니다." });
      }
      // Only permit deleting submissions belonging to the training-completions form.
      if (!submissions.some(item => String(item.id) === submissionId)) {
        return reply(404, { error: "수료 기록을 찾을 수 없습니다. 새로 로그인한 뒤 다시 시도해 주세요." });
      }
      const response = await fetch(`${API_BASE}/submissions/${encodeURIComponent(submissionId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
      });
      if (!response.ok) throw new Error("Netlify delete API: " + response.status);
      return reply(200, { success: true, deletedId: submissionId });
    }

    const records = submissions.map(item => ({
      submission_id: String(item.id),
      submitted_at: item.created_at,
      ...(item.data || {})
    }));

    return reply(200, { records });
  } catch (error) {
    console.error("Admin API error:", error.message);
    return reply(502, {
      error: input.action === "delete" ? "수료 기록 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요." : "수료 기록 조회에 실패했습니다."
    });
  }
};
