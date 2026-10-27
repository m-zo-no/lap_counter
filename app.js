"use strict";

// ==========================================================
// 設定
// ==========================================================

const STUDENT_COUNT = 20;
const DEFAULT_TARGET_LAPS = 5;

const BLINK_INTERVAL_MS = 600;

// 保存は「同じURLのブラウザー内」に行います。
const STORAGE_KEY = "lap-counter-countdown-v1";

// ==========================================================
// 画面の取得
// ==========================================================

const board = document.getElementById("board");
const startupError = document.getElementById("startup-error");
const notice = document.getElementById("notice");

const dialog = document.getElementById("student-dialog");
const studentForm = document.getElementById("student-form");

const nameInput = document.getElementById("student-name");
const targetInput = document.getElementById("student-target");
const resetInput = document.getElementById("reset-remaining");

const formError = document.getElementById("form-error");
const cancelButton = document.getElementById("cancel-button");

// ==========================================================
// アプリの状態
// ==========================================================

let students = [];

const cards = new Map();

let editingStudentId = null;

let blinkVisible = true;
let blinkTimer = null;

let noticeTimer = null;

// ==========================================================
// 初期データ
// ==========================================================

function createDefaultStudents() {
  return Array.from(
    { length: STUDENT_COUNT },
    (_, index) => ({
      id: index,
      name: `生徒${String(index + 1).padStart(2, "0")}`,
      target: DEFAULT_TARGET_LAPS,
      remaining: DEFAULT_TARGET_LAPS,
    })
  );
}

// ==========================================================
// 保存データの検証
// ==========================================================

function validateStudents(value) {
  if (!Array.isArray(value) || value.length !== STUDENT_COUNT) {
    throw new Error("20名分の保存データがありません。");
  }

  const usedIds = new Set();

  const validated = value.map((student) => {
    if (
      student === null ||
      typeof student !== "object" ||
      Array.isArray(student)
    ) {
      throw new Error("生徒データの形式が不正です。");
    }

    const { id, name, target, remaining } = student;

    if (
      !Number.isInteger(id) ||
      id < 0 ||
      id >= STUDENT_COUNT ||
      usedIds.has(id)
    ) {
      throw new Error("生徒番号が不正です。");
    }

    if (typeof name !== "string" || !name.trim()) {
      throw new Error("生徒名が不正です。");
    }

    if (!Number.isSafeInteger(target) || target < 1) {
      throw new Error("目標周数が不正です。");
    }

    if (
      !Number.isSafeInteger(remaining) ||
      remaining < 0 ||
      remaining > target
    ) {
      throw new Error("残り周数が不正です。");
    }

    usedIds.add(id);

    return {
      id,
      name: name.trim(),
      target,
      remaining,
    };
  });

  // ID順に固定。残り周数による並べ替えはしません。
  return validated.sort((a, b) => a.id - b.id);
}

// ==========================================================
// 読み込み・自動保存
// ==========================================================

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (saved === null) {
    return createDefaultStudents();
  }

  const payload = JSON.parse(saved);

  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("保存データの形式が不正です。");
  }

  if (payload.version !== 1) {
    throw new Error("対応していない保存データのバージョンです。");
  }

  return validateStudents(payload.students);
}

function saveData() {
  try {
    const payload = {
      version: 1,
      saved_at: new Date().toISOString(),
      students,
    };

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(payload)
    );

    hideNotice();
    return true;

  } catch (error) {
    showNotice(
      "記録を保存できませんでした。\n" +
      "画面上の記録は残っていますが、ページを閉じると失われる可能性があります。\n" +
      "ブラウザーの保存設定と空き容量を確認してください。",
      true
    );

    console.error("保存エラー:", error);
    return false;
  }
}

// ==========================================================
// 通知
// ==========================================================

function hideNotice() {
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }

  notice.hidden = true;
}

function showNotice(message, persistent = false) {
  hideNotice();

  notice.textContent = message;
  notice.hidden = false;

  if (!persistent) {
    noticeTimer = setTimeout(hideNotice, 5000);
  }
}

// ==========================================================
// 生徒カードの作成
// ==========================================================

function createCard(student) {
  const card = document.createElement("article");
  card.className = "student-card";

  // 名前欄
  const nameButton = document.createElement("button");
  nameButton.type = "button";
  nameButton.className = "card-section name-button";

  nameButton.addEventListener("click", () => {
    editStudent(student.id);
  });

  // 残り周数欄
  const countSection = document.createElement("div");
  countSection.className = "card-section count-section";

  const caption = document.createElement("span");
  caption.className = "remaining-caption";
  caption.setAttribute("aria-hidden", "true");

  ["の", "こ", "り"].forEach((character, index) => {
    if (index > 0) {
      caption.appendChild(document.createElement("br"));
    }

    caption.appendChild(
      document.createTextNode(character)
    );
  });

  const number = document.createElement("span");
  number.className = "remaining-number";
  number.setAttribute("aria-hidden", "true");

  const numberValue = document.createElement("span");

  const unit = document.createElement("span");
  unit.className = "remaining-unit";
  unit.textContent = " 周";

  number.append(numberValue, unit);
  countSection.append(caption, number);

  // 残り周数欄にはタップ操作を設定しません。

  // −1
  const minusButton = document.createElement("button");
  minusButton.type = "button";
  minusButton.className = "card-section minus-button";
  minusButton.textContent = "−1";

  minusButton.addEventListener("click", () => {
    changeRemaining(student.id, -1);
  });

  // ＋1
  const plusButton = document.createElement("button");
  plusButton.type = "button";
  plusButton.className = "card-section plus-button";
  plusButton.textContent = "＋1";

  plusButton.addEventListener("click", () => {
    changeRemaining(student.id, 1);
  });

  card.append(
    nameButton,
    countSection,
    minusButton,
    plusButton
  );

  cards.set(student.id, {
    card,
    nameButton,
    countSection,
    numberValue,
    minusButton,
    plusButton,
  });

  return card;
}

function buildScreen() {
  board.replaceChildren();
  cards.clear();

  // 一度だけID順に配置します。
  for (const student of students) {
    board.appendChild(createCard(student));
  }
}

// ==========================================================
// 表示更新：カードの位置は変更しない
// ==========================================================

function refreshStudent(studentId) {
  const student = students[studentId];
  const elements = cards.get(studentId);

  elements.nameButton.textContent = student.name;
  elements.nameButton.setAttribute(
    "aria-label",
    `${student.name}の名前と目標周数を編集`
  );

  elements.numberValue.textContent =
    String(student.remaining);

  elements.countSection.setAttribute(
    "aria-label",
    `${student.name}、残り${student.remaining}周`
  );

  elements.minusButton.setAttribute(
    "aria-label",
    `${student.name}の残り周数を1周減らす`
  );

  elements.plusButton.setAttribute(
    "aria-label",
    `${student.name}の残り周数を1周増やす`
  );

  // 操作できない状態は支援技術にも伝えます。
  // 色は元のデザインのままにします。
  elements.minusButton.setAttribute(
    "aria-disabled",
    String(student.remaining === 0)
  );

  elements.plusButton.setAttribute(
    "aria-disabled",
    String(student.remaining === student.target)
  );

  updateBlink(studentId);
}

function refreshAll() {
  for (const student of students) {
    refreshStudent(student.id);
  }
}

// ==========================================================
// 赤文字の点滅
// ==========================================================

function updateBlink(studentId) {
  const student = students[studentId];
  const { countSection } = cards.get(studentId);

  const isLast = student.remaining === 1;
  const isFinished = student.remaining === 0;

  countSection.classList.toggle("is-last", isLast);

  countSection.classList.toggle(
    "is-finished",
    isFinished
  );

  countSection.classList.toggle(
    "blink-hidden",
    isLast && !blinkVisible
  );
}

function scheduleBlink() {
  blinkTimer = setTimeout(
    blinkTick,
    BLINK_INTERVAL_MS
  );
}

function blinkTick() {
  blinkVisible = !blinkVisible;

  for (const student of students) {
    if (student.remaining === 1) {
      updateBlink(student.id);
    }
  }

  scheduleBlink();
}

function restartBlinkVisible() {
  if (blinkTimer !== null) {
    clearTimeout(blinkTimer);
    blinkTimer = null;
  }

  blinkVisible = true;

  for (const student of students) {
    if (student.remaining === 1) {
      updateBlink(student.id);
    }
  }

  scheduleBlink();
}

// ==========================================================
// 残り周数の変更
// ==========================================================

function changeRemaining(studentId, delta) {
  const student = students[studentId];

  const newValue = student.remaining + delta;

  // 0未満・目標周数を超える変更はしません。
  if (newValue < 0 || newValue > student.target) {
    return;
  }

  student.remaining = newValue;

  if (newValue === 1) {
    restartBlinkVisible();
  }

  // 押した生徒だけ更新。並べ替えはしません。
  refreshStudent(studentId);
  saveData();
}

// ==========================================================
// 名前と目標周数の編集
// ==========================================================

function showFormError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

function clearFormError() {
  formError.textContent = "";
  formError.hidden = true;
}

function editStudent(studentId) {
  if (dialog.open) {
    return;
  }

  const student = students[studentId];

  editingStudentId = studentId;

  nameInput.value = student.name;
  targetInput.value = String(student.target);
  resetInput.checked = false;

  clearFormError();

  dialog.showModal();

  nameInput.focus();
  nameInput.select();
}

function applySettings(event) {
  event.preventDefault();
  clearFormError();

  if (editingStudentId === null) {
    return;
  }

  const student = students[editingStudentId];

  const name = nameInput.value.trim();
  const targetText = targetInput.value.trim();
  const target = Number(targetText);

  if (!name) {
    showFormError("生徒名を入力してください。");
    nameInput.focus();
    return;
  }

  if (
    !targetText ||
    !Number.isSafeInteger(target) ||
    target < 1
  ) {
    showFormError(
      "目標周数は1以上の整数で入力してください。"
    );
    targetInput.focus();
    return;
  }

  const resetRemaining =
    target !== student.target ||
    resetInput.checked;

  if (resetRemaining) {
    const confirmed = window.confirm(
      `残り周数を${target}周に設定し直します。\n` +
      "よろしいですか？"
    );

    if (!confirmed) {
      return;
    }
  }

  student.name = name;
  student.target = target;

  if (resetRemaining) {
    student.remaining = target;

    if (target === 1) {
      restartBlinkVisible();
    }
  }

  refreshStudent(student.id);

  // 保存失敗時は編集画面を残します。
  if (saveData()) {
    dialog.close();
  } else {
    showFormError(
      "保存できませんでした。画面上には反映されています。" +
      "保存設定を確認して、もう一度「保存」を押してください。"
    );
  }
}

// ==========================================================
// イベント登録
// ==========================================================

studentForm.addEventListener("submit", applySettings);

cancelButton.addEventListener("click", () => {
  dialog.close();
});

dialog.addEventListener("close", () => {
  editingStudentId = null;
  clearFormError();
});

// 別のアプリから戻ったとき、残り1周を赤く表示し直します。
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && cards.size > 0) {
    restartBlinkVisible();
  }
});

// ==========================================================
// 起動
// ==========================================================

function main() {
  try {
    students = loadData();

  } catch (error) {
    // 不正な保存データを初期データで上書きしません。
    board.hidden = true;

    startupError.textContent =
      "起動できませんでした。\n" +
      "保存済み記録は上書きしていません。\n\n" +
      String(error.message || error) +
      "\n\nSafariの保存設定を確認してください。" +
      "サイトデータを削除すると記録も消えるため、" +
      "削除前に必要な記録を確認してください。";

    startupError.hidden = false;

    console.error("起動エラー:", error);
    return;
  }

  buildScreen();
  refreshAll();
  scheduleBlink();

  // 初回も保存し、保存可能か確認します。
  saveData();
}

main();
