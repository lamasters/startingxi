import { useEffect, useMemo, useRef, useState } from "react";

import type { FormEvent } from "react";
import { toPng } from "html-to-image";

type Role = "GK" | "D" | "M" | "F";

type Slot = {
  id: string;
  code: string;
  role: Role;
  label: string;
  x: number;
  y: number;
};

type Player = {
  id: string;
  name: string;
  primaryPosition: string;
  preferredPositions: string[];
};

type AssignmentMap = Record<string, string[]>;

type ShareableLineupState = {
  v: 1;
  formation: string;
  players: Array<{
    id: string;
    name: string;
    primaryPosition: string;
    preferredPositions: string[];
  }>;
  assignments: AssignmentMap;
  benched: string[];
  positionOffsets?: Record<string, number>;
  customLabels?: Record<string, string>;
};

type InitialLineupState = {
  formation: string;
  players: Player[];
  manualAssignments: AssignmentMap;
  benchedPlayerIds: string[];
  positionOffsets: Record<string, number>;
  customLabels: Record<string, string>;
};

const FORMATIONS = [
  "4-4-2",
  "4-3-3",
  "3-4-3",
  "4-2-3-1",
  "3-5-2",
  "5-3-2",
] as const;
const SHARE_PARAM = "lineup";
const DEFAULT_FORMATION = "4-4-2";

const FORMATION_POSITIONS: Record<string, Record<string, string[]>> = {
  "4-4-2": {
    D: ["LB", "LCB", "RCB", "RB"],
    M: ["LM", "LCM", "RCM", "RM"],
    F: ["LS", "RS"],
  },
  "4-3-3": {
    D: ["LB", "LCB", "RCB", "RB"],
    M: ["DM", "LCM", "RCM"],
    F: ["LW", "ST", "RW"],
  },
  "3-4-3": {
    D: ["LCB", "CB", "RCB"],
    M: ["LWB", "LCM", "RCM", "RWB"],
    F: ["LW", "ST", "RW"],
  },
  "4-2-3-1": {
    D: ["LB", "LCB", "RCB", "RB"],
    M: ["LDM", "RDM", "LAM", "AM", "RAM"],
    F: ["ST"],
  },
  "3-5-2": {
    D: ["LCB", "CB", "RCB"],
    M: ["LWB", "LCM", "AM", "RCM", "RWB"],
    F: ["LS", "RS"],
  },
  "5-3-2": {
    D: ["LWB", "LCB", "CB", "RCB", "RWB"],
    M: ["LCM", "DM", "RCM"],
    F: ["LS", "RS"],
  },
};

const SIDE_LABELS: Record<number, string[]> = {
  1: ["C"],
  2: ["L", "R"],
  3: ["L", "C", "R"],
  4: ["L", "CL", "CR", "R"],
  5: ["L", "CL", "C", "CR", "R"],
};

function parseFormation(formation: string): number[] {
  return formation
    .split("-")
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function slotLabelsForCount(count: number): string[] {
  if (SIDE_LABELS[count]) {
    return SIDE_LABELS[count];
  }

  return Array.from({ length: count }, (_, index) => `P${index + 1}`);
}

function buildSlots(formation: string): Slot[] {
  const outfieldLines = parseFormation(formation);
  const pitchBottom = 74;
  const pitchTop = 22;
  const pitchStep =
    outfieldLines.length > 1
      ? (pitchBottom - pitchTop) / (outfieldLines.length - 1)
      : 0;

  const slots: Slot[] = [
    {
      id: "GK",
      code: "GK",
      role: "GK",
      label: "Goalkeeper",
      x: 50,
      y: 90,
    },
  ];

  const formationPositions = FORMATION_POSITIONS[formation];

  outfieldLines.forEach((count, lineIndex) => {
    let role: Role;

    if (lineIndex === 0) {
      role = "D";
    } else if (lineIndex === outfieldLines.length - 1) {
      role = "F";
    } else {
      role = "M";
    }

    const y = pitchBottom - pitchStep * lineIndex;
    const labels = formationPositions
      ? formationPositions[role]
      : slotLabelsForCount(count);

    labels.forEach((positionLabel, playerIndex) => {
      let x: number;
      if (count === 1) {
        x = 50;
      } else if (role === "F" && count === 2) {
        // Bring 2 strikers closer to center (35 and 65 instead of 12 and 88)
        x = 35 + playerIndex * 30;
      } else {
        x = 12 + playerIndex * (76 / (count - 1));
      }

      slots.push({
        id: positionLabel,
        code: positionLabel,
        role,
        label: positionLabel,
        x,
        y,
      });
    });
  });

  return slots;
}

function normalizePreferredPositions(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(
      (entry, index, all) => entry.length > 0 && all.indexOf(entry) === index,
    );
}

function normalizePositionCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";

  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });

  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength =
    normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = normalized + "=".repeat(padLength);
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

function sanitizeAssignments(
  assignments: AssignmentMap,
  validPlayerIds: Set<string>,
): AssignmentMap {
  const safe: AssignmentMap = {};

  Object.entries(assignments).forEach(([slotId, ids]) => {
    if (!Array.isArray(ids)) {
      return;
    }

    const deduplicated = ids.filter((id, index, all) => {
      return (
        typeof id === "string" &&
        validPlayerIds.has(id) &&
        all.indexOf(id) === index
      );
    });

    if (deduplicated.length > 0) {
      safe[slotId] = deduplicated;
    }
  });

  return safe;
}

function parseInitialLineupState(): InitialLineupState {
  const defaultState: InitialLineupState = {
    formation: DEFAULT_FORMATION,
    players: [],
    manualAssignments: {},
    benchedPlayerIds: [],
    positionOffsets: {},
    customLabels: {},
  };

  try {
    const currentUrl = new URL(window.location.href);
    const encoded = currentUrl.searchParams.get(SHARE_PARAM);

    if (!encoded) {
      return defaultState;
    }

    const payload = JSON.parse(
      fromBase64Url(encoded),
    ) as Partial<ShareableLineupState>;
    const formation = FORMATIONS.includes(
      payload.formation as (typeof FORMATIONS)[number],
    )
      ? (payload.formation as string)
      : DEFAULT_FORMATION;

    const parsedPlayers: Player[] = Array.isArray(payload.players)
      ? payload.players
          .map((rawPlayer) => {
            const safeName =
              typeof rawPlayer.name === "string" ? rawPlayer.name.trim() : "";
            const safePrimaryPosition =
              typeof rawPlayer.primaryPosition === "string"
                ? normalizePositionCode(rawPlayer.primaryPosition)
                : "GK";
            const safePreferredPositions = Array.isArray(
              rawPlayer.preferredPositions,
            )
              ? rawPlayer.preferredPositions
                  .filter(
                    (position): position is string =>
                      typeof position === "string",
                  )
                  .map((position) => normalizePositionCode(position))
                  .filter(
                    (position, index, all) =>
                      position.length > 0 && all.indexOf(position) === index,
                  )
              : [];

            if (!safeName) {
              return null;
            }

            return {
              id:
                typeof rawPlayer.id === "string" &&
                rawPlayer.id.trim().length > 0
                  ? rawPlayer.id
                  : crypto.randomUUID(),
              name: safeName,
              primaryPosition: safePrimaryPosition,
              preferredPositions: safePreferredPositions,
            };
          })
          .filter((player): player is Player => Boolean(player))
      : [];

    const playerIds = new Set(parsedPlayers.map((player) => player.id));
    const manualAssignments =
      payload.assignments && typeof payload.assignments === "object"
        ? sanitizeAssignments(payload.assignments as AssignmentMap, playerIds)
        : {};

    const benchedPlayerIds = Array.isArray(payload.benched)
      ? payload.benched.filter(
          (id): id is string => typeof id === "string" && playerIds.has(id),
        )
      : [];

    const positionOffsets =
      payload.positionOffsets && typeof payload.positionOffsets === "object"
        ? Object.fromEntries(
            Object.entries(payload.positionOffsets).filter(
              ([, value]) => typeof value === "number",
            ),
          )
        : {};

    const customLabels =
      payload.customLabels && typeof payload.customLabels === "object"
        ? Object.fromEntries(
            Object.entries(payload.customLabels).filter(
              ([, value]) => typeof value === "string",
            ),
          )
        : {};

    return {
      formation,
      players: parsedPlayers,
      manualAssignments,
      benchedPlayerIds,
      positionOffsets,
      customLabels,
    };
  } catch {
    return defaultState;
  }
}

function encodeShareableLineupState(
  state: InitialLineupState & {
    benchedPlayerIds: string[];
    positionOffsets: Record<string, number>;
    customLabels: Record<string, string>;
  },
): string {
  const payload: ShareableLineupState = {
    v: 1,
    formation: state.formation,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      primaryPosition: player.primaryPosition,
      preferredPositions: player.preferredPositions,
    })),
    assignments: state.manualAssignments,
    benched: state.benchedPlayerIds,
    positionOffsets: state.positionOffsets,
    customLabels: state.customLabels,
  };

  return toBase64Url(JSON.stringify(payload));
}

function preferredPositionsLabel(player: Player): string {
  return player.preferredPositions.length > 0
    ? player.preferredPositions.join(", ")
    : "None";
}

function positionScore(player: Player, slotCode: string): number {
  if (player.primaryPosition === slotCode) {
    return 2;
  }

  return player.preferredPositions.includes(slotCode) ? 1 : 0;
}

function deriveLineup(
  players: Player[],
  slots: Slot[],
  manualAssignments: AssignmentMap,
  benchedPlayerIds: Set<string>,
): { bySlot: Record<string, Player[]>; bench: Player[] } {
  const bySlot: Record<string, Player[]> = Object.fromEntries(
    slots.map((slot) => [slot.id, []]),
  );
  const assignedPlayerIds = new Set<string>();

  slots.forEach((slot) => {
    const assignedIds = manualAssignments[slot.id] ?? [];
    const assignedPlayers = assignedIds
      .map((id) => players.find((player) => player.id === id))
      .filter((player): player is Player => Boolean(player));

    bySlot[slot.id] = assignedPlayers;

    assignedPlayers.forEach((player) => {
      assignedPlayerIds.add(player.id);
    });
  });

  const unassignedPlayers = players.filter(
    (player) =>
      !assignedPlayerIds.has(player.id) && !benchedPlayerIds.has(player.id),
  );

  unassignedPlayers.forEach((player) => {
    const candidates = slots
      .map((slot) => ({ slot, score: positionScore(player, slot.code) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }

        return bySlot[a.slot.id].length - bySlot[b.slot.id].length;
      });

    if (candidates.length === 0) {
      return;
    }

    bySlot[candidates[0].slot.id].push(player);
    assignedPlayerIds.add(player.id);
  });

  const bench = players.filter((player) => !assignedPlayerIds.has(player.id));

  return { bySlot, bench };
}

function App() {
  const [initialState] = useState<InitialLineupState>(parseInitialLineupState);
  const [formation, setFormation] = useState<string>(initialState.formation);
  const [players, setPlayers] = useState<Player[]>(initialState.players);
  const [manualAssignments, setManualAssignments] = useState<AssignmentMap>(
    initialState.manualAssignments,
  );
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPrimaryPosition, setNewPrimaryPosition] = useState("GK");
  const [newPreferredPositions, setNewPreferredPositions] = useState("");
  const [assignmentPlayerId, setAssignmentPlayerId] = useState("");
  const [assignmentPosition, setAssignmentPosition] = useState("");
  const [benchedPlayerIds, setBenchedPlayerIds] = useState<string[]>(
    initialState.benchedPlayerIds,
  );
  const [benchAssignmentTargets, setBenchAssignmentTargets] = useState<
    Record<string, string>
  >({});
  const [shareUrl, setShareUrl] = useState(() => window.location.href);
  const [copyMessage, setCopyMessage] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [positionOffsets, setPositionOffsets] = useState<
    Record<string, number>
  >(initialState.positionOffsets);
  const [draggingSlotId, setDraggingSlotId] = useState<string | null>(null);
  const [dragStartY, setDragStartY] = useState(0);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [customLabels, setCustomLabels] = useState<Record<string, string>>(
    initialState.customLabels,
  );
  const [editingPlayerPreferredId, setEditingPlayerPreferredId] = useState<
    string | null
  >(null);
  const [editingPlayerPreferredText, setEditingPlayerPreferredText] =
    useState("");
  const [editingPlayerPrimaryId, setEditingPlayerPrimaryId] = useState<
    string | null
  >(null);
  const [editingPlayerPrimaryText, setEditingPlayerPrimaryText] = useState("");
  const exportRef = useRef<HTMLDivElement | null>(null);
  const labelInputRef = useRef<HTMLInputElement | null>(null);

  const slots = useMemo(() => buildSlots(formation), [formation]);

  const slotCodes = useMemo(() => slots.map((slot) => slot.code), [slots]);

  const slotByCode = useMemo(() => {
    return Object.fromEntries(slots.map((slot) => [slot.code, slot]));
  }, [slots]);

  useEffect(() => {
    setNewPrimaryPosition((current) =>
      slotCodes.includes(current) ? current : "GK",
    );
    setAssignmentPosition((current) =>
      slotCodes.includes(current) ? current : (slotCodes[0] ?? "GK"),
    );
    setManualAssignments((current) => {
      const validSlotIds = new Set(slots.map((slot) => slot.id));
      const filtered: AssignmentMap = {};

      Object.entries(current).forEach(([slotId, ids]) => {
        if (validSlotIds.has(slotId)) {
          filtered[slotId] = ids;
        }
      });

      return filtered;
    });
  }, [slotCodes, slots]);

  useEffect(() => {
    const validPlayerIds = new Set(players.map((player) => player.id));
    const safeAssignments = sanitizeAssignments(
      manualAssignments,
      validPlayerIds,
    );
    const encodedState = encodeShareableLineupState({
      formation,
      players,
      manualAssignments: safeAssignments,
      benchedPlayerIds,
      positionOffsets,
      customLabels,
    });
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set(SHARE_PARAM, encodedState);
    window.history.replaceState({}, "", nextUrl);
    setShareUrl(nextUrl.toString());
  }, [
    formation,
    players,
    manualAssignments,
    benchedPlayerIds,
    positionOffsets,
    customLabels,
  ]);

  const benchedSet = useMemo(
    () => new Set(benchedPlayerIds),
    [benchedPlayerIds],
  );

  const lineup = useMemo(
    () => deriveLineup(players, slots, manualAssignments, benchedSet),
    [players, slots, manualAssignments, benchedSet],
  );

  function addPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanName = newPlayerName.trim();
    if (!cleanName) {
      return;
    }

    const newPlayer: Player = {
      id: crypto.randomUUID(),
      name: cleanName,
      primaryPosition: newPrimaryPosition,
      preferredPositions: normalizePreferredPositions(newPreferredPositions),
    };

    setPlayers((current) => [...current, newPlayer]);
    setNewPlayerName("");
    setNewPreferredPositions("");
  }

  function removePlayer(playerId: string) {
    setPlayers((current) => current.filter((player) => player.id !== playerId));
    setManualAssignments((current) => {
      const updated: AssignmentMap = {};

      Object.entries(current).forEach(([slotId, ids]) => {
        updated[slotId] = ids.filter((id) => id !== playerId);
      });

      return updated;
    });
    setBenchedPlayerIds((current) => current.filter((id) => id !== playerId));
    setBenchAssignmentTargets((current) => {
      const next = { ...current };
      delete next[playerId];
      return next;
    });
  }

  function preferredAssignmentCode(player: Player): string {
    if (slotCodes.includes(player.primaryPosition)) {
      return player.primaryPosition;
    }

    return slotCodes[0] ?? "GK";
  }

  function assignPlayer(playerId: string, slotCode: string) {
    const slot = slotByCode[slotCode];
    if (!slot) {
      return;
    }

    setManualAssignments((current) => {
      const ids = current[slot.id] ?? [];
      if (ids.includes(playerId)) {
        return current;
      }

      return {
        ...current,
        [slot.id]: [...ids, playerId],
      };
    });
    setBenchedPlayerIds((current) => current.filter((id) => id !== playerId));
  }

  function unassignPlayer(slotId: string, playerId: string) {
    setManualAssignments((current) => {
      const ids = current[slotId] ?? [];
      return {
        ...current,
        [slotId]: ids.filter((id) => id !== playerId),
      };
    });
    setBenchedPlayerIds((current) =>
      current.includes(playerId) ? current : [...current, playerId],
    );
  }

  function movePlayerUp(slotId: string, playerId: string) {
    setManualAssignments((current) => {
      const ids = current[slotId] ?? [];
      const index = ids.indexOf(playerId);
      if (index <= 0) return current;

      const newIds = [...ids];
      [newIds[index - 1], newIds[index]] = [newIds[index], newIds[index - 1]];
      return {
        ...current,
        [slotId]: newIds,
      };
    });
  }

  function movePlayerDown(slotId: string, playerId: string) {
    setManualAssignments((current) => {
      const ids = current[slotId] ?? [];
      const index = ids.indexOf(playerId);
      if (index < 0 || index >= ids.length - 1) return current;

      const newIds = [...ids];
      [newIds[index], newIds[index + 1]] = [newIds[index + 1], newIds[index]];
      return {
        ...current,
        [slotId]: newIds,
      };
    });
  }

  function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignmentPlayerId || !assignmentPosition) {
      return;
    }

    assignPlayer(assignmentPlayerId, assignmentPosition);
  }

  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyMessage("Link copied.");
    } catch {
      setCopyMessage("Copy failed. Select and copy manually.");
    }
  }

  async function exportLineupAsPng() {
    if (!exportRef.current || isExporting) {
      return;
    }

    setIsExporting(true);
    setExportMessage("");

    try {
      const dataUrl = await toPng(exportRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#f4f7f0",
      });
      const link = document.createElement("a");
      const fileFormation = formation.replace(/[^0-9-]/g, "");

      link.download = `soccer-lineup-${fileFormation}.png`;
      link.href = dataUrl;
      link.click();
      setExportMessage("PNG exported.");
    } catch {
      setExportMessage("Export failed. Try again.");
    } finally {
      setIsExporting(false);
    }
  }

  function handleNodeMouseDown(
    event: React.MouseEvent<HTMLElement>,
    slotId: string,
  ) {
    // Don't start drag if clicking the remove button
    if ((event.target as HTMLElement).tagName === "BUTTON") {
      return;
    }
    setDraggingSlotId(slotId);
    setDragStartY(event.clientY);
  }

  useEffect(() => {
    if (!draggingSlotId) return;

    function handleMouseMove(event: MouseEvent) {
      const deltaY = event.clientY - dragStartY;
      // Convert pixel movement to percentage (constrain to ±10%)
      const maxOffset = 10;
      const offset = Math.max(-maxOffset, Math.min(maxOffset, deltaY / 50));

      setPositionOffsets((current) => ({
        ...current,
        [draggingSlotId ?? ""]: offset,
      }));
    }

    function handleMouseUp() {
      setDraggingSlotId(null);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [draggingSlotId, dragStartY]);

  function startEditingLabel(slotId: string, currentLabel: string) {
    setEditingSlotId(slotId);
    setEditingLabel(currentLabel);
  }

  function saveLabel(slotId: string) {
    if (editingLabel.trim()) {
      setCustomLabels((current) => ({
        ...current,
        [slotId]: editingLabel.trim(),
      }));
    }
    setEditingSlotId(null);
    setEditingLabel("");
  }

  function handleLabelKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    slotId: string,
  ) {
    if (event.key === "Enter") {
      saveLabel(slotId);
    } else if (event.key === "Escape") {
      setEditingSlotId(null);
      setEditingLabel("");
    }
  }

  useEffect(() => {
    if (editingSlotId !== null && labelInputRef.current) {
      labelInputRef.current.select();
    }
  }, [editingSlotId]);

  function startEditingPreferred(playerId: string, currentPreferred: string[]) {
    setEditingPlayerPreferredId(playerId);
    setEditingPlayerPreferredText(currentPreferred.join(", "));
  }

  function savePreferred(playerId: string) {
    const normalized = normalizePreferredPositions(editingPlayerPreferredText);
    setPlayers((current) =>
      current.map((player) =>
        player.id === playerId
          ? { ...player, preferredPositions: normalized }
          : player,
      ),
    );
    setEditingPlayerPreferredId(null);
    setEditingPlayerPreferredText("");
  }

  function handlePreferredKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    playerId: string,
  ) {
    if (event.key === "Enter") {
      savePreferred(playerId);
    } else if (event.key === "Escape") {
      setEditingPlayerPreferredId(null);
      setEditingPlayerPreferredText("");
    }
  }

  function startEditingPrimary(playerId: string, currentPrimary: string) {
    setEditingPlayerPrimaryId(playerId);
    setEditingPlayerPrimaryText(currentPrimary);
  }

  function savePrimary(playerId: string) {
    const normalized = normalizePositionCode(editingPlayerPrimaryText);
    if (normalized) {
      setPlayers((current) =>
        current.map((player) =>
          player.id === playerId
            ? { ...player, primaryPosition: normalized }
            : player,
        ),
      );
    }
    setEditingPlayerPrimaryId(null);
    setEditingPlayerPrimaryText("");
  }

  function handlePrimaryKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    playerId: string,
  ) {
    if (event.key === "Enter") {
      savePrimary(playerId);
    } else if (event.key === "Escape") {
      setEditingPlayerPrimaryId(null);
      setEditingPlayerPrimaryText("");
    }
  }

  return (
    <main className="app-shell">
      <div className="app-heading">
        <h1>Starting XI</h1>
        <p className="subtitle">
          Pick your formation, add your squad, then let automatic matching place
          players by primary and preferred positions.
        </p>
      </div>

      <section className="control-panel">
        <div className="card">
          <label htmlFor="formation">Formation</label>
          <select
            id="formation"
            value={formation}
            onChange={(event) => setFormation(event.target.value)}
          >
            {FORMATIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="card form-grid">
          <h2>Share lineup</h2>
          <label htmlFor="share-url">Shareable URL</label>
          <div className="share-row">
            <input
              id="share-url"
              className="share-link"
              value={shareUrl}
              readOnly
            />
            <button type="button" onClick={copyShareUrl}>
              Copy
            </button>
          </div>
          {copyMessage ? <p className="copy-note">{copyMessage}</p> : null}
        </div>

        <form className="card form-grid" onSubmit={addPlayer}>
          <h2>Add player</h2>
          <label htmlFor="player-name">Player name</label>
          <input
            id="player-name"
            value={newPlayerName}
            onChange={(event) => setNewPlayerName(event.target.value)}
            placeholder="e.g. Alex Morgan"
            required
          />

          <label htmlFor="player-primary">Assigned position</label>
          <select
            id="player-primary"
            value={newPrimaryPosition}
            onChange={(event) => setNewPrimaryPosition(event.target.value)}
          >
            {slotCodes.map((position) => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </select>

          <label htmlFor="player-preferred">
            Preferred positions (comma separated)
          </label>
          <input
            id="player-preferred"
            value={newPreferredPositions}
            onChange={(event) => setNewPreferredPositions(event.target.value)}
            placeholder="M-C, M-R, F-C"
          />

          <button type="submit">Add to squad</button>
        </form>

        <form className="card form-grid" onSubmit={submitAssignment}>
          <h2>Manual lineup assignment</h2>
          <label htmlFor="assign-player">Player</label>
          <select
            id="assign-player"
            value={assignmentPlayerId}
            onChange={(event) => setAssignmentPlayerId(event.target.value)}
          >
            <option value="">Select player</option>
            {players
              .toSorted((a, b) => a.name.localeCompare(b.name))
              .map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
          </select>

          <label htmlFor="assign-position">Position</label>
          <select
            id="assign-position"
            value={assignmentPosition}
            onChange={(event) => setAssignmentPosition(event.target.value)}
          >
            {slotCodes.map((position) => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </select>

          <button type="submit">Assign player</button>
        </form>

        <div className="card players-card">
          <h2>Squad ({players.length})</h2>
          {players.length === 0 ? (
            <p className="empty-note">
              Add players to begin building your lineup.
            </p>
          ) : (
            <ul className="player-list">
              {players
                .toSorted((a, b) => a.name.localeCompare(b.name))
                .map((player) => {
                  const isEditingPreferred =
                    editingPlayerPreferredId === player.id;
                  const isEditingPrimary = editingPlayerPrimaryId === player.id;
                  return (
                    <li key={player.id}>
                      <div>
                        <strong>{player.name}</strong>
                        {isEditingPrimary ? (
                          <input
                            autoFocus
                            type="text"
                            className="player-primary-input"
                            value={editingPlayerPrimaryText}
                            onChange={(event) =>
                              setEditingPlayerPrimaryText(event.target.value)
                            }
                            onBlur={() => savePrimary(player.id)}
                            onKeyDown={(event) =>
                              handlePrimaryKeyDown(event, player.id)
                            }
                            placeholder="e.g. ST"
                          />
                        ) : (
                          <span
                            className="player-primary"
                            onClick={() =>
                              startEditingPrimary(
                                player.id,
                                player.primaryPosition,
                              )
                            }
                            title="Click to edit"
                          >
                            Primary: {player.primaryPosition}
                          </span>
                        )}
                        {isEditingPreferred ? (
                          <input
                            autoFocus
                            type="text"
                            className="player-preferred-input"
                            value={editingPlayerPreferredText}
                            onChange={(event) =>
                              setEditingPlayerPreferredText(event.target.value)
                            }
                            onBlur={() => savePreferred(player.id)}
                            onKeyDown={(event) =>
                              handlePreferredKeyDown(event, player.id)
                            }
                            placeholder="e.g. M-C, M-R, F-C"
                          />
                        ) : (
                          <span
                            className="player-preferred"
                            onClick={() =>
                              startEditingPreferred(
                                player.id,
                                player.preferredPositions,
                              )
                            }
                            title="Click to edit"
                          >
                            Preferred:{" "}
                            {player.preferredPositions.length > 0
                              ? player.preferredPositions.join(", ")
                              : "None"}
                          </span>
                        )}
                      </div>
                      <div className="row-actions">
                        <button
                          type="button"
                          onClick={() =>
                            assignPlayer(player.id, player.primaryPosition)
                          }
                        >
                          Assign
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => removePlayer(player.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      </section>

      <section className="pitch-panel">
        <div
          ref={exportRef}
          className={`export-surface${isExporting ? " is-exporting" : ""}`}
        >
          <div className="export-header card">
            <div>
              <h2>Lineup</h2>
            </div>
            <span className="formation-badge">{formation}</span>
          </div>

          <div className="pitch">
            <div className="mid-line" />
            <div className="center-circle" />
            <div className="penalty-box top" />
            <div className="penalty-box bottom" />

            {slots.map((slot) => {
              const positionedPlayers = lineup.bySlot[slot.id] ?? [];
              const offset = positionOffsets[slot.id] ?? 0;
              const displayLabel = customLabels[slot.id] ?? slot.code;
              const isEditing = editingSlotId === slot.id;

              return (
                <article
                  key={slot.id}
                  className="position-node"
                  style={{
                    left: `${slot.x}%`,
                    top: `${slot.y + offset}%`,
                    cursor: draggingSlotId === slot.id ? "grabbing" : "grab",
                  }}
                  aria-label={`${slot.code} position`}
                  onMouseDown={(event) => handleNodeMouseDown(event, slot.id)}
                >
                  {isEditing ? (
                    <input
                      ref={labelInputRef}
                      autoFocus
                      type="text"
                      className="position-label-input"
                      value={editingLabel}
                      onChange={(event) => setEditingLabel(event.target.value)}
                      onBlur={() => saveLabel(slot.id)}
                      onKeyDown={(event) => handleLabelKeyDown(event, slot.id)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : (
                    <header
                      onClick={() => startEditingLabel(slot.id, displayLabel)}
                      className="position-label"
                      title="Click to edit"
                    >
                      {displayLabel}
                    </header>
                  )}
                  <ul>
                    {positionedPlayers.length === 0 ? (
                      <li className="placeholder">Open</li>
                    ) : (
                      positionedPlayers.map((player, playerIndex) => (
                        <li key={player.id}>
                          <span className="player-name-wrap">
                            <span className="player-name" tabIndex={0}>
                              {player.name}
                            </span>
                            <span className="player-tooltip" role="tooltip">
                              Preferred: {preferredPositionsLabel(player)}
                            </span>
                          </span>
                          <div className="player-actions">
                            {positionedPlayers.length > 1 && (
                              <>
                                {playerIndex > 0 && (
                                  <button
                                    type="button"
                                    title="Move up"
                                    onClick={() =>
                                      movePlayerUp(slot.id, player.id)
                                    }
                                    className="order-button"
                                  >
                                    ↑
                                  </button>
                                )}
                                {playerIndex < positionedPlayers.length - 1 && (
                                  <button
                                    type="button"
                                    title="Move down"
                                    onClick={() =>
                                      movePlayerDown(slot.id, player.id)
                                    }
                                    className="order-button"
                                  >
                                    ↓
                                  </button>
                                )}
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => unassignPlayer(slot.id, player.id)}
                            >
                              x
                            </button>
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                </article>
              );
            })}
          </div>
        </div>
        <div className="bench card export-hidden">
          <h2>Bench / Unmatched</h2>
          {lineup.bench.length === 0 ? (
            <p className="empty-note">
              All players are matched to at least one position.
            </p>
          ) : (
            <ul className="bench-list">
              {lineup.bench
                .toSorted((a, b) => a.name.localeCompare(b.name))
                .map((player) => {
                  const selectedSlot = slotCodes.includes(
                    benchAssignmentTargets[player.id] ?? "",
                  )
                    ? (benchAssignmentTargets[player.id] as string)
                    : preferredAssignmentCode(player);

                  return (
                    <li key={player.id}>
                      <span className="bench-player-name">{player.name}</span>
                      <div className="bench-assign-row">
                        <select
                          aria-label={`Assign ${player.name} to position`}
                          value={selectedSlot}
                          onChange={(event) => {
                            const nextSlot = event.target.value;
                            setBenchAssignmentTargets((current) => ({
                              ...current,
                              [player.id]: nextSlot,
                            }));
                          }}
                        >
                          {slotCodes.map((position) => (
                            <option key={position} value={position}>
                              {position}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => assignPlayer(player.id, selectedSlot)}
                        >
                          Assign
                        </button>
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>

        <div className="pitch-toolbar card">
          <div>
            <h2>Export lineup</h2>
            <p className="copy-note">
              Save the current pitch and bench as a PNG.
            </p>
          </div>
          <div className="pitch-toolbar-actions">
            <button type="button" onClick={exportLineupAsPng}>
              {isExporting ? "Exporting..." : "Export PNG"}
            </button>
            {exportMessage ? (
              <p className="copy-note export-note">{exportMessage}</p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
