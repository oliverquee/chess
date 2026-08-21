export const DEFAULT_DAILY_GOAL = 3;
export const MONTHLY_FREEZES = 2;
export const MASTERY_CATEGORIES = Object.freeze([
  'tactical',
  'king_safety',
  'pawn_structure',
  'piece_activity',
  'positional_judgment',
  'endgame_technique',
  'practical_time',
]);

/**
 * Calculates daily session progress towards the goal target.
 */
export function calculateDailyProgress(dailyStats, goalTarget = DEFAULT_DAILY_GOAL) {
  const sessionsCompleted = dailyStats?.sessionsCompleted ?? dailyStats?.sessions_completed ?? 0;
  const target = Math.max(1, goalTarget);
  const percent = Math.min(100, Math.round((sessionsCompleted / target) * 100));
  const goalMet = sessionsCompleted >= target;

  return {
    sessionsCompleted,
    goalTarget: target,
    goalMet,
    percent,
  };
}

function parseDateDays(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map((n) => Number.parseInt(n, 10));
  return Date.UTC(y, m - 1, d) / (1000 * 60 * 60 * 24);
}

/**
 * Processes daily streak state transition with anti-gaming floor and monthly freezes.
 */
export function processDailyStreakUpdate({
  streakState = {},
  currentDate = new Date().toISOString().slice(0, 10),
  sessionsCompletedToday = 0,
  goalTarget = DEFAULT_DAILY_GOAL,
} = {}) {
  let currentStreak = streakState?.currentStreak ?? streakState?.current_streak ?? 0;
  let longestStreak = streakState?.longestStreak ?? streakState?.longest_streak ?? 0;
  let freezesRemaining = streakState?.freezesRemaining ?? streakState?.freezes_remaining ?? MONTHLY_FREEZES;
  let freezesMonth = streakState?.freezesMonth ?? streakState?.freezes_month ?? null;
  let lastCountedDate = streakState?.lastCountedDate ?? streakState?.last_counted_date ?? null;

  const currentMonth = currentDate.slice(0, 7);
  if (freezesMonth !== currentMonth) {
    freezesMonth = currentMonth;
    freezesRemaining = MONTHLY_FREEZES;
  }

  let usedFreeze = false;
  let streakBroken = false;

  // Streak only increments if the daily goal floor is satisfied
  if (sessionsCompletedToday >= goalTarget) {
    if (lastCountedDate === currentDate) {
      // Already counted for today
      return {
        currentStreak,
        longestStreak,
        freezesRemaining,
        freezesMonth,
        lastCountedDate,
        usedFreeze,
        streakBroken,
      };
    }

    if (!lastCountedDate) {
      // First day
      currentStreak = 1;
    } else {
      const currentDays = parseDateDays(currentDate);
      const lastDays = parseDateDays(lastCountedDate);
      const diffDays = currentDays - lastDays;

      if (diffDays === 1) {
        // Consecutive day
        currentStreak += 1;
      } else if (diffDays > 1) {
        const daysMissed = diffDays - 1;
        if (daysMissed <= freezesRemaining) {
          // Saved by streak freeze(s)
          freezesRemaining -= daysMissed;
          currentStreak += 1;
          usedFreeze = true;
        } else {
          // Not enough freezes -> streak resets to 1
          currentStreak = 1;
          streakBroken = true;
        }
      }
    }

    if (currentStreak > longestStreak) {
      longestStreak = currentStreak;
    }
    lastCountedDate = currentDate;
  }

  return {
    currentStreak,
    longestStreak,
    freezesRemaining,
    freezesMonth,
    lastCountedDate,
    usedFreeze,
    streakBroken,
  };
}

/**
 * Calculates category mastery advancement on completed session.
 */
export function advanceCategoryMastery(currentLevel = 0, sessionScore = 0) {
  const level = Number.isInteger(currentLevel) ? currentLevel : 0;
  if (sessionScore >= 70) {
    return Math.min(5, level + 1);
  }
  return level;
}

/**
 * Checks and computes mastery decay for categories inactive for > 14 days.
 */
export function checkMasteryDecay(masteryMap = {}, nowIso = new Date().toISOString()) {
  const nowDays = Date.parse(nowIso) / (1000 * 60 * 60 * 24);
  const updated = {};

  for (const category of MASTERY_CATEGORIES) {
    const current = masteryMap[category] || {
      category,
      masteryLevel: 0,
      lastPracticedAt: null,
      decayCheckedAt: null,
    };

    let level = current.masteryLevel ?? current.mastery_level ?? 0;
    const lastPracticed = current.lastPracticedAt ?? current.last_practiced_at;

    if (lastPracticed && level > 0) {
      const lastDays = Date.parse(lastPracticed) / (1000 * 60 * 60 * 24);
      const diffDays = nowDays - lastDays;

      if (diffDays > 14) {
        const decayAmount = Math.floor((diffDays - 14) / 14) + 1;
        level = Math.max(0, level - decayAmount);
      }
    }

    updated[category] = {
      category,
      masteryLevel: level,
      lastPracticedAt: lastPracticed,
      decayCheckedAt: nowIso,
    };
  }

  return updated;
}

