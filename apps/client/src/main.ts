import * as THREE from "three";
import type { FoundCompanyInput, ServerMessage } from "@tokenvalley/shared";
import { startDemo } from "./demo";
import { WsClient } from "./net/ws";
import { Store, type CameraMode } from "./state/store";
import { Overlay } from "./ui/overlay";
import { CameraRig, type FirstPersonWorld } from "./world/camera";
import { Director } from "./world/director";
import { spotTile, tileToWorld } from "./world/office";
import { skyTexture } from "./world/style";
import { Valley } from "./world/valley";

const WS_URL = "ws://localhost:8787";

// Valley walking bounds and building footprint (matches Valley.makeBuilding).
const VALLEY_HALF_W = 76;
const VALLEY_HALF_D = 56;
const BUILDING_HALF_W = 4.2;
const BUILDING_HALF_D = 3.7;
const DOOR_HALF_W = 0.8;

function bootstrap(): void {
  const app = document.getElementById("app");
  const overlayRoot = document.getElementById("overlay");
  if (!app || !overlayRoot) throw new Error("missing #app or #overlay");

  const store = new Store();
  store.demo = new URLSearchParams(window.location.search).get("demo") === "1";

  // ---- renderer and scene ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  app.append(renderer.domElement);

  // Pastel toy-city look: pale sky gradient, matching fog, warm soft light.
  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xf6f2f3, 110, 260);

  const sky = new THREE.HemisphereLight(0xfff4ec, 0xf3c6d3, 1.5);
  scene.add(sky);
  const ambient = new THREE.AmbientLight(0xffe9f0, 0.7);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff1e0, 1.9);
  sun.position.set(30, 50, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 180;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun);
  /** Tight shadow frustum in the office, wide over the whole valley. */
  const fitShadows = (valleyView: boolean) => {
    const s = valleyView ? 88 : 26;
    const cam = sun.shadow.camera;
    cam.left = -s;
    cam.right = s;
    cam.top = valleyView ? 68 : s;
    cam.bottom = valleyView ? -68 : -s;
    cam.updateProjectionMatrix();
  };
  fitShadows(true);

  const valley = new Valley();
  scene.add(valley.group);
  const director = new Director(scene, store, { sun, sky });
  const rig = new CameraRig(window.innerWidth / window.innerHeight);
  rig.camera.fov = 35;
  rig.camera.updateProjectionMatrix();
  rig.attach(renderer.domElement);
  rig.followTarget = () => director.characterPosition(store.selectedAgentId);

  const ws = store.demo ? null : new WsClient(WS_URL);

  // Which world the first-person walker is in.
  let fpContext: "valley" | "office" = "office";

  // ---- visibility ----
  const applyVisibility = () => {
    const mode = store.cameraMode;
    const inValley = mode === "valley" || (mode === "firstperson" && fpContext === "valley");
    valley.group.visible = inValley;
    fitShadows(inValley);
    director.setVisible(!inValley);
    for (const ch of director.characters.values()) ch.group.visible = !inValley;
    const office = director.office;
    if (office?.visitorMarker) office.visitorMarker.visible = mode !== "firstperson";
    document.body.classList.toggle("firstperson", mode === "firstperson");
  };

  // ---- first-person worlds ----
  const officeWorld = (): FirstPersonWorld => ({
    blocked: (x, z) => director.office?.blockedAt(x, z) ?? true,
  });

  const valleyWorld = (): FirstPersonWorld => ({
    blocked: (x, z) => {
      if (Math.abs(x) > VALLEY_HALF_W || Math.abs(z) > VALLEY_HALF_D) return true;
      if (valley.blockedAt(x, z)) return true;
      for (const c of store.companies.values()) {
        const p = valley.buildingPosition(c.id);
        if (!p) continue;
        const dx = x - p.x;
        const dz = z - p.z;
        if (Math.abs(dx) < BUILDING_HALF_W && Math.abs(dz) < BUILDING_HALF_D) {
          // The front door is an opening; walking into it enters the office.
          const inDoor = Math.abs(dx) < DOOR_HALF_W && dz > BUILDING_HALF_D - 1.2;
          return !inDoor;
        }
      }
      return false;
    },
    probe: (x, z) => {
      for (const c of store.companies.values()) {
        const p = valley.buildingPosition(c.id);
        if (!p) continue;
        if (Math.abs(x - p.x) < DOOR_HALF_W && z < p.z + BUILDING_HALF_D - 0.3 && z > p.z + BUILDING_HALF_D - 1.3) {
          enterOfficeFirstPerson(c.id);
          return;
        }
      }
    },
  });

  const enterOfficeFirstPerson = (companyId: string) => {
    focusCompany(companyId, false, true);
    fpContext = "office";
    const entrance = spotTile("entrance") ?? { x: 1, z: 14 };
    // Stand on the entrance tile looking into the office (+x).
    rig.enterFirstPerson(tileToWorld(entrance), -Math.PI / 2, officeWorld());
    store.cameraMode = "firstperson";
    applyVisibility();
    store.notify();
  };

  const enterValleyFirstPerson = () => {
    fpContext = "valley";
    const p = (store.focusedCompanyId ? valley.buildingPosition(store.focusedCompanyId) : null) ?? new THREE.Vector3();
    // On the road in front of the focused building, facing it (-z).
    rig.enterFirstPerson(new THREE.Vector3(p.x, 0, p.z + 10), 0, valleyWorld());
    store.cameraMode = "firstperson";
    applyVisibility();
    store.notify();
  };

  // ---- camera / focus ----
  const setCamera = (mode: CameraMode) => {
    if (mode === "firstperson") {
      const fromValley = store.cameraMode === "valley" || (store.cameraMode === "firstperson" && fpContext === "valley");
      if (fromValley || !store.focusedCompanyId || !director.office) enterValleyFirstPerson();
      else enterOfficeFirstPerson(store.focusedCompanyId);
      return;
    }
    if (mode === "follow" && !store.selectedAgentId) {
      const first = store.focusedCompanyId ? store.agentsOf(store.focusedCompanyId)[0] : undefined;
      if (first) store.selectedAgentId = first.id;
    }
    if ((mode === "office" || mode === "follow" || mode === "meeting") && !store.focusedCompanyId) mode = "valley";
    store.cameraMode = mode;
    rig.meetingCenter.copy(director.meetingCenter());
    rig.setMode(mode);
    applyVisibility();
    store.notify();
  };

  rig.onPointerUnlock = () => {
    if (store.cameraMode !== "firstperson") return;
    setCamera(fpContext === "valley" ? "valley" : "office");
  };

  const focusCompany = (companyId: string, enter = false, keepCamera = false) => {
    if (!store.companies.has(companyId)) return;
    const changed = store.focusedCompanyId !== companyId;
    store.setFocus(companyId);
    director.setFocus(companyId);
    if (changed) ws?.send({ kind: "focus_company", companyId });
    if (keepCamera) {
      applyVisibility();
      store.notify();
    } else if (enter || (changed && store.cameraMode !== "valley")) setCamera("office");
    else {
      rig.meetingCenter.copy(director.meetingCenter());
      applyVisibility();
      store.notify();
    }
  };

  const overlay = new Overlay(overlayRoot, store, {
    focusCompany: (id) => focusCompany(id, false),
    selectAgent: (id) => {
      store.selectedAgentId = id;
      setCamera("follow");
    },
    setCamera,
    setSpeed: (s) => {
      store.speed = s;
      store.notify();
    },
    foundCompany: (input: FoundCompanyInput) => {
      if (!ws || !ws.send({ kind: "found_company", input })) overlay.showFoundError("Not connected to the server.");
    },
    resolveApproval: (approvalId, status, comment) => {
      const approval = store.approvals.get(approvalId);
      if (ws) {
        ws.send({ kind: "resolve_approval", approvalId, status, comment });
      } else if (approval) {
        // Demo: resolve locally so the office reacts.
        handleMessage({
          kind: "event",
          event: { id: `local-${Date.now()}`, companyId: approval.companyId, timestamp: Date.now(), type: "approval_resolved", approval: { ...approval, status, founderComment: comment } },
        });
      }
    },
    sendFounderMessage: (companyId, text) => {
      ws?.send({ kind: "founder_message", companyId, text });
    },
    setAgentPersona: (agentId, name, style, job) => {
      const agent = store.agents.get(agentId);
      if (ws) {
        ws.send({ kind: "set_agent_persona", agentId, name, style, job });
      } else if (agent) {
        // Demo: apply locally by synthesising the event the server would send.
        handleMessage({
          kind: "event",
          event: { id: `local-${Date.now()}`, companyId: agent.companyId, timestamp: Date.now(), type: "agent_persona_changed", agentId, name, style, job },
        });
      }
    },
    pauseCompany: (companyId) => {
      if (ws) ws.send({ kind: "pause_company", companyId });
      else localPhase(companyId, "paused");
    },
    resumeCompany: (companyId) => {
      if (ws) ws.send({ kind: "resume_company", companyId });
      else localPhase(companyId, "building");
    },
    panic: () => {
      if (ws) ws.send({ kind: "panic" });
      else for (const id of store.companies.keys()) localPhase(id, "paused");
    },
  });

  /** Demo: mirrors the company_phase event the server would emit for pause/resume/panic. */
  function localPhase(companyId: string, phase: "paused" | "building"): void {
    if (!store.companies.has(companyId)) return;
    handleMessage({ kind: "event", event: { id: `local-${Date.now()}-${companyId}`, companyId, timestamp: Date.now(), type: "company_phase", phase } });
  }

  /** Opens the approval dialog if the focused company has one pending. */
  const surfacePendingApproval = () => {
    const id = store.focusedCompanyId;
    const pending = id ? store.pendingApprovalFor(id) : null;
    if (pending && !overlay.isApprovalOpen()) overlay.openApproval(pending.id);
  };

  // ---- messages ----
  const handleMessage = (m: ServerMessage) => {
    switch (m.kind) {
      case "snapshot":
        store.applySnapshot(m);
        director.setFocus(store.focusedCompanyId);
        valley.sync(store);
        rig.meetingCenter.copy(director.meetingCenter());
        applyVisibility();
        surfacePendingApproval();
        break;
      case "event":
        store.applyEvent(m.event);
        if (m.event.type === "company_founded" && !store.focusedCompanyId) focusCompany(m.event.company.id);
        director.handle(m.event);
        valley.sync(store);
        applyVisibility();
        if (m.event.type === "request_approval" && m.event.companyId === store.focusedCompanyId) overlay.openApproval(m.event.approval.id);
        if (m.event.type === "approval_resolved") overlay.closeApproval(m.event.approval.id);
        if (m.event.type === "agent_persona_changed") overlay.closePersona(m.event.agentId);
        break;
      case "focus_changed":
        focusCompany(m.companyId, false);
        break;
      case "founded":
        overlay.closeFoundModal();
        if (store.companies.has(m.companyId)) focusCompany(m.companyId, true);
        break;
      case "error":
        console.warn("[server]", m.message);
        overlay.showFoundError(m.message);
        break;
    }
  };

  if (ws) {
    ws.onMessage(handleMessage);
    ws.onStatus((s) => {
      store.connection = s;
      store.notify();
    });
    ws.connect();
  } else {
    store.connection = "connected";
    startDemo(handleMessage);
  }

  // ---- picking buildings on the valley map ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (store.cameraMode !== "valley") return;
    if (!rig.consumeClick()) return;
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, rig.camera);
    const id = valley.pick(raycaster);
    if (id) focusCompany(id, true);
  });

  // ---- keys ----
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
    switch (e.key) {
      case "1":
        setCamera("valley");
        break;
      case "2":
        setCamera("office");
        break;
      case "3":
        setCamera("follow");
        break;
      case "4":
        setCamera("meeting");
        break;
      case "5":
        setCamera("firstperson");
        break;
      case "Escape":
        // Menus and dialogs first, topmost wins; only then does Esc move the camera.
        if (overlay.handleEscape()) break;
        if (store.cameraMode === "firstperson") setCamera(fpContext === "valley" ? "valley" : "office");
        else setCamera(store.focusedCompanyId ? "office" : "valley");
        break;
    }
  });

  // ---- resize ----
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    rig.resize(window.innerWidth / window.innerHeight);
  });

  // ---- main loop: fixed-ish delta, scaled by the animation speed ----
  const clock = new THREE.Clock();
  const tick = () => {
    const raw = Math.min(0.05, clock.getDelta());
    const dt = raw * store.speed;
    director.update(dt);
    valley.update(dt);
    rig.update(raw);
    renderer.render(scene, rig.camera);
    requestAnimationFrame(tick);
  };
  applyVisibility();
  requestAnimationFrame(tick);

  // Debug hook for driving the client from the console or scripts.
  (window as unknown as { tokenvalley: unknown }).tokenvalley = { store, rig, director, valley, overlay, renderer, setCamera, focusCompany, handleMessage };
}

bootstrap();
