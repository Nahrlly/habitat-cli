#!/usr/bin/env bun

import { Command, InvalidArgumentError } from "commander";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Status = "open" | "closed";
type RoomType = "airlock" | "greenhouse";

type Door = {
  name: string;
  status: Status;
  locked: boolean;
};

type Airlock = {
  name: string;
  pressureLevel: number;
  airComposition: string;
  doorStatus: Status;
  sanitationLevel: number;
  needsSanitization: boolean;
  sanitationStartedAt: number | null;
  doorNames: string[];
  isPowered: boolean;
  powerDemand: number;
};

type Greenhouse = {
  name: string;
  temperature: number;
  humidity: number;
  airComposition: string;
  lightLevel: string;
  integrity: number;
  growing: string[];
  airlockNames: string[];
  doorNames: string[];
  isPowered: boolean;
  powerDemand: number;
};

type OxygenSystem = {
  name: string;
  oxygenLevel: number;
  airConcentration: number;
};

type Battery = {
  name: string;
  chargeAmount: number;
  isCharging: boolean;
  providingEnergyTo: string[];
};

type PoweredRoom = {
  roomType: RoomType;
  roomName: string;
  powerDemand: number;
};

type PowerSystem = {
  name: string;
  batteryNames: string[];
  numBatteries: number;
  totalPowerStored: number;
  roomsReceivingPower: PoweredRoom[];
};

type Store = {
  airlocks: Airlock[];
  doors: Door[];
  greenhouses: Greenhouse[];
  oxygenSystems: OxygenSystem[];
  batteries: Battery[];
  powerSystems: PowerSystem[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirectory = path.resolve(__dirname, "../data");
const storeFilePath = path.join(dataDirectory, "airlock.json");
const sanitizationDurationMs = 5_000;
const defaultAirlockName = "primary-airlock";

const defaultStore: Store = {
  airlocks: [],
  doors: [],
  greenhouses: [],
  oxygenSystems: [],
  batteries: [],
  powerSystems: [],
};

function createAirlock(name: string): Airlock {
  return {
    name,
    pressureLevel: 100,
    airComposition: "standard",
    doorStatus: "closed",
    sanitationLevel: 0,
    needsSanitization: false,
    sanitationStartedAt: null,
    doorNames: [],
    isPowered: false,
    powerDemand: 0,
  };
}

function createGreenhouse(name: string): Greenhouse {
  return {
    name,
    temperature: 22,
    humidity: 45,
    airComposition: "balanced",
    lightLevel: "medium",
    integrity: 100,
    growing: [],
    airlockNames: [],
    doorNames: [],
    isPowered: false,
    powerDemand: 0,
  };
}

function createOxygenSystem(name: string): OxygenSystem {
  return {
    name,
    oxygenLevel: 100,
    airConcentration: 21,
  };
}

function createBattery(name: string): Battery {
  return {
    name,
    chargeAmount: 100,
    isCharging: false,
    providingEnergyTo: [],
  };
}

function createPowerSystem(name: string): PowerSystem {
  return {
    name,
    batteryNames: [],
    numBatteries: 0,
    totalPowerStored: 0,
    roomsReceivingPower: [],
  };
}

function ensureStoreFile(): void {
  mkdirSync(dataDirectory, { recursive: true });

  try {
    readFileSync(storeFilePath, "utf8");
  } catch {
    saveStore(defaultStore);
  }
}

function loadStore(): Store {
  ensureStoreFile();

  try {
    const rawStore = JSON.parse(readFileSync(storeFilePath, "utf8")) as unknown;
    return refreshStore(normalizeStore(rawStore));
  } catch {
    saveStore(defaultStore);
    return defaultStore;
  }
}

function saveStore(store: Store): void {
  mkdirSync(dataDirectory, { recursive: true });
  const temporaryFilePath = `${storeFilePath}.${process.pid}.tmp`;
  writeFileSync(temporaryFilePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  renameSync(temporaryFilePath, storeFilePath);
}

function normalizeStore(rawStore: unknown): Store {
  if (!isObject(rawStore)) {
    saveStore(defaultStore);
    return defaultStore;
  }

  const normalizedStore: Store = {
    airlocks: Array.isArray(rawStore.airlocks) ? rawStore.airlocks.map(normalizeAirlock) : [],
    doors: Array.isArray(rawStore.doors) ? rawStore.doors.map(normalizeDoor) : [],
    greenhouses: Array.isArray(rawStore.greenhouses) ? rawStore.greenhouses.map(normalizeGreenhouse) : [],
    oxygenSystems: Array.isArray(rawStore.oxygenSystems)
      ? rawStore.oxygenSystems.map(normalizeOxygenSystem)
      : [],
    batteries: Array.isArray(rawStore.batteries) ? rawStore.batteries.map(normalizeBattery) : [],
    powerSystems: Array.isArray(rawStore.powerSystems) ? rawStore.powerSystems.map(normalizePowerSystem) : [],
  };

  if (JSON.stringify(rawStore) !== JSON.stringify(normalizedStore)) {
    saveStore(normalizedStore);
  }

  return normalizedStore;
}

function normalizeAirlock(rawAirlock: unknown): Airlock {
  const input = isObject(rawAirlock) ? rawAirlock : {};

  return {
    name: typeof input.name === "string" ? input.name : defaultAirlockName,
    pressureLevel: typeof input.pressureLevel === "number" ? input.pressureLevel : 100,
    airComposition: typeof input.airComposition === "string" ? input.airComposition : "standard",
    doorStatus: input.doorStatus === "open" ? "open" : "closed",
    sanitationLevel: typeof input.sanitationLevel === "number" ? input.sanitationLevel : 0,
    needsSanitization: typeof input.needsSanitization === "boolean" ? input.needsSanitization : false,
    sanitationStartedAt: typeof input.sanitationStartedAt === "number" ? input.sanitationStartedAt : null,
    doorNames: Array.isArray(input.doorNames) ? input.doorNames.filter(isString) : [],
    isPowered: typeof input.isPowered === "boolean" ? input.isPowered : false,
    powerDemand: typeof input.powerDemand === "number" ? input.powerDemand : 0,
  };
}

function normalizeDoor(rawDoor: unknown): Door {
  const input = isObject(rawDoor) ? rawDoor : {};

  return {
    name: typeof input.name === "string" ? input.name : "unnamed-door",
    status: input.status === "open" ? "open" : "closed",
    locked: typeof input.locked === "boolean" ? input.locked : false,
  };
}

function normalizeGreenhouse(rawGreenhouse: unknown): Greenhouse {
  const input = isObject(rawGreenhouse) ? rawGreenhouse : {};

  return {
    name: typeof input.name === "string" ? input.name : "primary-greenhouse",
    temperature: typeof input.temperature === "number" ? input.temperature : 22,
    humidity: typeof input.humidity === "number" ? input.humidity : 45,
    airComposition: typeof input.airComposition === "string" ? input.airComposition : "balanced",
    lightLevel: typeof input.lightLevel === "string" ? input.lightLevel : "medium",
    integrity: typeof input.integrity === "number" ? input.integrity : 100,
    growing: Array.isArray(input.growing) ? input.growing.filter(isString) : [],
    airlockNames: Array.isArray(input.airlockNames) ? input.airlockNames.filter(isString) : [],
    doorNames: Array.isArray(input.doorNames) ? input.doorNames.filter(isString) : [],
    isPowered: typeof input.isPowered === "boolean" ? input.isPowered : false,
    powerDemand: typeof input.powerDemand === "number" ? input.powerDemand : 0,
  };
}

function normalizeOxygenSystem(rawOxygenSystem: unknown): OxygenSystem {
  const input = isObject(rawOxygenSystem) ? rawOxygenSystem : {};

  return {
    name: typeof input.name === "string" ? input.name : "primary-oxygen-system",
    oxygenLevel: typeof input.oxygenLevel === "number" ? input.oxygenLevel : 100,
    airConcentration: typeof input.airConcentration === "number" ? input.airConcentration : 21,
  };
}

function normalizeBattery(rawBattery: unknown): Battery {
  const input = isObject(rawBattery) ? rawBattery : {};

  return {
    name: typeof input.name === "string" ? input.name : "unnamed-battery",
    chargeAmount: typeof input.chargeAmount === "number" ? input.chargeAmount : 100,
    isCharging: typeof input.isCharging === "boolean" ? input.isCharging : false,
    providingEnergyTo: Array.isArray(input.providingEnergyTo) ? input.providingEnergyTo.filter(isString) : [],
  };
}

function normalizePoweredRoom(rawRoom: unknown): PoweredRoom | null {
  const input = isObject(rawRoom) ? rawRoom : {};

  if ((input.roomType !== "airlock" && input.roomType !== "greenhouse") || typeof input.roomName !== "string") {
    return null;
  }

  return {
    roomType: input.roomType,
    roomName: input.roomName,
    powerDemand: typeof input.powerDemand === "number" ? input.powerDemand : 0,
  };
}

function normalizePowerSystem(rawPowerSystem: unknown): PowerSystem {
  const input = isObject(rawPowerSystem) ? rawPowerSystem : {};
  const roomsReceivingPower = Array.isArray(input.roomsReceivingPower)
    ? input.roomsReceivingPower.map(normalizePoweredRoom).filter((room): room is PoweredRoom => room !== null)
    : [];

  return {
    name: typeof input.name === "string" ? input.name : "primary-power-system",
    batteryNames: Array.isArray(input.batteryNames) ? input.batteryNames.filter(isString) : [],
    numBatteries: typeof input.numBatteries === "number" ? input.numBatteries : 0,
    totalPowerStored: typeof input.totalPowerStored === "number" ? input.totalPowerStored : 0,
    roomsReceivingPower,
  };
}

function refreshStore(store: Store): Store {
  const refreshedAirlocks = store.airlocks.map(refreshAirlock);
  const refreshedStore = recalculatePowerState({
    ...store,
    airlocks: refreshedAirlocks,
  });

  if (JSON.stringify(store) !== JSON.stringify(refreshedStore)) {
    saveStore(refreshedStore);
  }

  return refreshedStore;
}

function refreshAirlock(airlock: Airlock): Airlock {
  if (airlock.sanitationStartedAt === null) {
    return airlock;
  }

  const elapsedMs = Date.now() - airlock.sanitationStartedAt;

  if (elapsedMs < sanitizationDurationMs) {
    return airlock;
  }

  return {
    ...airlock,
    sanitationLevel: 100,
    needsSanitization: false,
    sanitationStartedAt: null,
  };
}

function recalculatePowerState(store: Store): Store {
  const systems = store.powerSystems.map((currentPowerSystem) => {
    const batteries = currentPowerSystem.batteryNames
      .map((batteryName) => findBattery(store, batteryName))
      .filter((battery): battery is Battery => battery !== undefined);
    const totalPowerStored = batteries.reduce((sum, battery) => sum + battery.chargeAmount, 0);

    return {
      ...currentPowerSystem,
      batteryNames: batteries.map((battery) => battery.name),
      numBatteries: batteries.length,
      totalPowerStored,
    };
  });

  const roomPower = new Map<string, { isPowered: boolean; demand: number }>();
  const batteryTargets = new Map<string, string[]>();

  for (const battery of store.batteries) {
    batteryTargets.set(battery.name, []);
  }

  for (const currentPowerSystem of systems) {
    const totalDemand = currentPowerSystem.roomsReceivingPower.reduce((sum, room) => sum + room.powerDemand, 0);
    const canPowerRooms = totalDemand > 0 && currentPowerSystem.totalPowerStored >= totalDemand;

    for (const currentRoom of currentPowerSystem.roomsReceivingPower) {
      roomPower.set(getRoomKey(currentRoom.roomType, currentRoom.roomName), {
        isPowered: canPowerRooms,
        demand: currentRoom.powerDemand,
      });
    }

    for (const batteryName of currentPowerSystem.batteryNames) {
      const existingTargets = batteryTargets.get(batteryName) ?? [];
      batteryTargets.set(
        batteryName,
        currentPowerSystem.roomsReceivingPower.map((room) => `${room.roomType}:${room.roomName}`).concat(existingTargets),
      );
    }
  }

  return {
    airlocks: store.airlocks.map((airlock) => {
      const power = roomPower.get(getRoomKey("airlock", airlock.name));
      return {
        ...airlock,
        isPowered: power?.isPowered ?? false,
        powerDemand: power?.demand ?? 0,
      };
    }),
    doors: store.doors,
    greenhouses: store.greenhouses.map((greenhouse) => {
      const power = roomPower.get(getRoomKey("greenhouse", greenhouse.name));
      return {
        ...greenhouse,
        isPowered: power?.isPowered ?? false,
        powerDemand: power?.demand ?? 0,
      };
    }),
    oxygenSystems: store.oxygenSystems,
    batteries: store.batteries.map((battery) => ({
      ...battery,
      providingEnergyTo: batteryTargets.get(battery.name) ?? [],
    })),
    powerSystems: systems,
  };
}

function getRoomKey(roomType: RoomType, roomName: string): string {
  return `${roomType}:${roomName}`;
}

function getRemainingSanitizationSeconds(airlock: Airlock): number {
  if (airlock.sanitationStartedAt === null) {
    return 0;
  }

  const elapsedMs = Date.now() - airlock.sanitationStartedAt;
  return Math.max(1, Math.ceil((sanitizationDurationMs - elapsedMs) / 1000));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function findAirlock(store: Store, airlockName: string): Airlock | undefined {
  return store.airlocks.find((airlock) => airlock.name === airlockName);
}

function findDoor(store: Store, doorName: string): Door | undefined {
  return store.doors.find((door) => door.name === doorName);
}

function findGreenhouse(store: Store, greenhouseName: string): Greenhouse | undefined {
  return store.greenhouses.find((greenhouse) => greenhouse.name === greenhouseName);
}

function findOxygenSystem(store: Store, oxygenSystemName: string): OxygenSystem | undefined {
  return store.oxygenSystems.find((oxygenSystem) => oxygenSystem.name === oxygenSystemName);
}

function findBattery(store: Store, batteryName: string): Battery | undefined {
  return store.batteries.find((battery) => battery.name === batteryName);
}

function findPowerSystem(store: Store, powerSystemName: string): PowerSystem | undefined {
  return store.powerSystems.find((powerSystem) => powerSystem.name === powerSystemName);
}

function requireAirlock(store: Store, airlockName: string): Airlock {
  const airlock = findAirlock(store, airlockName);

  if (!airlock) {
    throw new Error(`Airlock not found: ${airlockName}`);
  }

  return airlock;
}

function requireDoor(store: Store, doorName: string): Door {
  const door = findDoor(store, doorName);

  if (!door) {
    throw new Error(`Door not found: ${doorName}`);
  }

  return door;
}

function requireGreenhouse(store: Store, greenhouseName: string): Greenhouse {
  const greenhouse = findGreenhouse(store, greenhouseName);

  if (!greenhouse) {
    throw new Error(`Greenhouse not found: ${greenhouseName}`);
  }

  return greenhouse;
}

function requireOxygenSystem(store: Store, oxygenSystemName: string): OxygenSystem {
  const oxygenSystem = findOxygenSystem(store, oxygenSystemName);

  if (!oxygenSystem) {
    throw new Error(`Oxygen system not found: ${oxygenSystemName}`);
  }

  return oxygenSystem;
}

function requireBattery(store: Store, batteryName: string): Battery {
  const battery = findBattery(store, batteryName);

  if (!battery) {
    throw new Error(`Battery not found: ${batteryName}`);
  }

  return battery;
}

function requirePowerSystem(store: Store, powerSystemName: string): PowerSystem {
  const powerSystem = findPowerSystem(store, powerSystemName);

  if (!powerSystem) {
    throw new Error(`Power system not found: ${powerSystemName}`);
  }

  return powerSystem;
}

function requirePoweredAirlock(store: Store, airlockName: string): Airlock {
  const airlock = requireAirlock(store, airlockName);

  if (!airlock.isPowered) {
    throw new Error(`Airlock is not powered: ${airlockName}`);
  }

  return airlock;
}

function requirePoweredGreenhouse(store: Store, greenhouseName: string): Greenhouse {
  const greenhouse = requireGreenhouse(store, greenhouseName);

  if (!greenhouse.isPowered) {
    throw new Error(`Greenhouse is not powered: ${greenhouseName}`);
  }

  return greenhouse;
}

function parseStatus(value: string): Status {
  if (value !== "open" && value !== "closed") {
    throw new InvalidArgumentError("Status must be 'open' or 'closed'.");
  }

  return value;
}

function parseRoomType(value: string): RoomType {
  if (value !== "airlock" && value !== "greenhouse") {
    throw new InvalidArgumentError("Room type must be 'airlock' or 'greenhouse'.");
  }

  return value;
}

function parseBoolean(value: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new InvalidArgumentError("Value must be 'true' or 'false'.");
}

function parsePositiveNumber(value: string, fieldName: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError(`${fieldName} must be a non-negative number.`);
  }

  return parsed;
}

const program = new Command();

program
  .name("habitat")
  .description("A tiny Habitat CLI.")
  .version("0.1.0");

const airlock = program.command("airlock").description("Manage airlocks.");
const door = program.command("door").description("Manage doors.");
const greenhouse = program.command("greenhouse").description("Manage greenhouse rooms.");
const oxygenSystem = program.command("oxygen-system").description("Manage oxygen systems.");
const battery = program.command("battery").description("Manage batteries.");
const powerSystem = program.command("power-system").description("Manage power systems.");

airlock
  .command("create")
  .description("Create an airlock.")
  .argument("<name>", "name for the airlock")
  .action((name: string) => {
    const store = loadStore();

    if (findAirlock(store, name)) {
      console.error(`Airlock already exists: ${name}`);
      process.exitCode = 1;
      return;
    }

    saveStore({
      ...store,
      airlocks: [...store.airlocks, createAirlock(name)],
    });

    console.log(`Airlock created: ${name}`);
  });

airlock
  .command("list")
  .description("List airlocks.")
  .action(() => {
    const store = loadStore();

    if (store.airlocks.length === 0) {
      console.log("No airlocks found.");
      return;
    }

    for (const currentAirlock of store.airlocks) {
      console.log(currentAirlock.name);
    }
  });

airlock
  .command("show")
  .description("Show an airlock and its doors.")
  .argument("<name>", "airlock name")
  .action((name: string) => {
    try {
      const store = loadStore();
      const currentAirlock = requireAirlock(store, name);
      const attachedDoors = currentAirlock.doorNames
        .map((doorName) => findDoor(store, doorName))
        .filter((currentDoor): currentDoor is Door => currentDoor !== undefined);

      console.log(JSON.stringify({ ...currentAirlock, doors: attachedDoors }, null, 2));
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

airlock
  .command("delete")
  .description("Delete an airlock.")
  .argument("<name>", "airlock name")
  .action((name: string) => {
    const store = loadStore();

    if (!findAirlock(store, name)) {
      console.error(`Airlock not found: ${name}`);
      process.exitCode = 1;
      return;
    }

    saveStore({
      ...store,
      airlocks: store.airlocks.filter((currentAirlock) => currentAirlock.name !== name),
      greenhouses: store.greenhouses.map((currentGreenhouse) => ({
        ...currentGreenhouse,
        airlockNames: currentGreenhouse.airlockNames.filter((airlockName) => airlockName !== name),
      })),
      powerSystems: store.powerSystems.map((currentPowerSystem) => ({
        ...currentPowerSystem,
        roomsReceivingPower: currentPowerSystem.roomsReceivingPower.filter(
          (room) => !(room.roomType === "airlock" && room.roomName === name),
        ),
      })),
    });

    console.log(`Airlock deleted: ${name}`);
  });

airlock
  .command("add-door")
  .description("Attach a door to an airlock.")
  .argument("<airlockName>", "airlock name")
  .argument("<doorName>", "door name")
  .action((airlockName: string, doorName: string) => {
    try {
      const store = loadStore();
      requireDoor(store, doorName);
      requireAirlock(store, airlockName);

      saveStore({
        ...store,
        airlocks: store.airlocks.map((currentAirlock) =>
          currentAirlock.name !== airlockName || currentAirlock.doorNames.includes(doorName)
            ? currentAirlock
            : {
                ...currentAirlock,
                doorNames: [...currentAirlock.doorNames, doorName],
              },
        ),
      });

      console.log(`Door ${doorName} attached to airlock ${airlockName}.`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

airlock
  .command("open")
  .description("Open an airlock door.")
  .argument("<name>", "airlock name")
  .action((name: string) => {
    try {
      const store = loadStore();
      const currentAirlock = requirePoweredAirlock(store, name);

      if (currentAirlock.needsSanitization) {
        console.error("Airlock cannot be opened until sanitization is complete.");
        process.exitCode = 1;
        return;
      }

      saveStore({
        ...store,
        airlocks: store.airlocks.map((airlockItem) =>
          airlockItem.name === name
            ? {
                ...airlockItem,
                doorStatus: "open",
                pressureLevel: 25,
                airComposition: "oxygen-reduced",
              }
            : airlockItem,
        ),
      });

      console.log(`Airlock opened: ${name}. Pressure level is now 25.`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

airlock
  .command("close")
  .description("Close an airlock door.")
  .argument("<name>", "airlock name")
  .action((name: string) => {
    try {
      const store = loadStore();
      requirePoweredAirlock(store, name);

      saveStore({
        ...store,
        airlocks: store.airlocks.map((airlockItem) =>
          airlockItem.name === name
            ? {
                ...airlockItem,
                doorStatus: "closed",
                pressureLevel: 100,
                airComposition: "standard",
                sanitationLevel: 0,
                needsSanitization: true,
                sanitationStartedAt: null,
              }
            : airlockItem,
        ),
      });

      console.log(`Airlock closed: ${name}. Pressure level restored to 100. Sanitization is now required.`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

airlock
  .command("sanitize")
  .description("Sanitize an airlock.")
  .argument("<name>", "airlock name")
  .action((name: string) => {
    try {
      const store = loadStore();
      const currentAirlock = requirePoweredAirlock(store, name);

      if (currentAirlock.doorStatus === "open") {
        console.error("Close the airlock before starting sanitization.");
        process.exitCode = 1;
        return;
      }

      if (!currentAirlock.needsSanitization) {
        console.log("Airlock is already clean.");
        return;
      }

      if (currentAirlock.sanitationStartedAt !== null) {
        console.log(
          `Sanitization is in progress. ${getRemainingSanitizationSeconds(currentAirlock)} second(s) remaining.`,
        );
        return;
      }

      saveStore({
        ...store,
        airlocks: store.airlocks.map((airlockItem) =>
          airlockItem.name === name
            ? {
                ...airlockItem,
                sanitationStartedAt: Date.now(),
              }
            : airlockItem,
        ),
      });

      console.log(`Sanitization started for ${name}. Wait 5 seconds for the airlock to become clean.`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

airlock
  .command("check-pressure")
  .description("Check an airlock pressure level.")
  .argument("<name>", "airlock name")
  .action((name: string) => {
    try {
      const store = loadStore();
      const currentAirlock = requireAirlock(store, name);
      console.log(`Airlock pressure level for ${name}: ${currentAirlock.pressureLevel}`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

door
  .command("create")
  .description("Create a door.")
  .argument("<name>", "door name")
  .action((name: string) => {
    const store = loadStore();

    if (findDoor(store, name)) {
      console.error(`Door already exists: ${name}`);
      process.exitCode = 1;
      return;
    }

    saveStore({
      ...store,
      doors: [...store.doors, { name, status: "closed", locked: false }],
    });

    console.log(`Door created: ${name}`);
  });

door
  .command("list")
  .description("List doors.")
  .action(() => {
    const store = loadStore();

    if (store.doors.length === 0) {
      console.log("No doors found.");
      return;
    }

    for (const currentDoor of store.doors) {
      console.log(currentDoor.name);
    }
  });

door
  .command("show")
  .description("Show a door.")
  .argument("<name>", "door name")
  .action((name: string) => {
    try {
      const store = loadStore();
      const currentDoor = requireDoor(store, name);
      console.log(JSON.stringify(currentDoor, null, 2));
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

door
  .command("update")
  .description("Update a door.")
  .argument("<name>", "door name")
  .option("--status <status>", "door status: open or closed", parseStatus)
  .option("--locked <locked>", "door locked state: true or false")
  .action((name: string, options: { status?: Status; locked?: string }) => {
    try {
      const store = loadStore();
      requireDoor(store, name);

      if (options.status === undefined && options.locked === undefined) {
        console.error("Provide --status and/or --locked.");
        process.exitCode = 1;
        return;
      }

      saveStore({
        ...store,
        doors: store.doors.map((doorItem) =>
          doorItem.name !== name
            ? doorItem
            : {
                ...doorItem,
                status: options.status ?? doorItem.status,
                locked: options.locked === undefined ? doorItem.locked : parseBoolean(options.locked),
              },
        ),
      });

      console.log(`Door updated: ${name}`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

door
  .command("delete")
  .description("Delete a door.")
  .argument("<name>", "door name")
  .action((name: string) => {
    const store = loadStore();

    if (!findDoor(store, name)) {
      console.error(`Door not found: ${name}`);
      process.exitCode = 1;
      return;
    }

    saveStore({
      ...store,
      airlocks: store.airlocks.map((airlockItem) => ({
        ...airlockItem,
        doorNames: airlockItem.doorNames.filter((doorName) => doorName !== name),
      })),
      doors: store.doors.filter((doorItem) => doorItem.name !== name),
      greenhouses: store.greenhouses.map((greenhouseItem) => ({
        ...greenhouseItem,
        doorNames: greenhouseItem.doorNames.filter((doorName) => doorName !== name),
      })),
    });

    console.log(`Door deleted: ${name}`);
  });

greenhouse
  .command("create")
  .description("Create a greenhouse room.")
  .argument("<name>", "greenhouse name")
  .action((name: string) => {
    const store = loadStore();

    if (findGreenhouse(store, name)) {
      console.error(`Greenhouse already exists: ${name}`);
      process.exitCode = 1;
      return;
    }

    saveStore({
      ...store,
      greenhouses: [...store.greenhouses, createGreenhouse(name)],
    });

    console.log(`Greenhouse created: ${name}`);
  });

greenhouse
  .command("status")
  .description("Check the status of a greenhouse room.")
  .argument("<name>", "greenhouse name")
  .action((name: string) => {
    try {
      const store = loadStore();
      const currentGreenhouse = requireGreenhouse(store, name);

      console.log(
        JSON.stringify(
          {
            ...currentGreenhouse,
            connectedAirlocks: currentGreenhouse.airlockNames,
            connectedDoors: currentGreenhouse.doorNames,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

greenhouse
  .command("growing")
  .description("Check what is growing in a greenhouse room.")
  .argument("<name>", "greenhouse name")
  .action((name: string) => {
    try {
      const store = loadStore();
      const currentGreenhouse = requireGreenhouse(store, name);

      if (currentGreenhouse.growing.length === 0) {
        console.log(`Nothing is currently growing in ${name}.`);
        return;
      }

      console.log(`Growing in ${name}: ${currentGreenhouse.growing.join(", ")}`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

greenhouse
  .command("plant")
  .description("Plant something in a greenhouse room.")
  .argument("<name>", "greenhouse name")
  .argument("<thing>", "thing to plant")
  .action((name: string, thing: string) => {
    try {
      const store = loadStore();
      requirePoweredGreenhouse(store, name);

      saveStore({
        ...store,
        greenhouses: store.greenhouses.map((greenhouseItem) =>
          greenhouseItem.name !== name || greenhouseItem.growing.includes(thing)
            ? greenhouseItem
            : {
                ...greenhouseItem,
                growing: [...greenhouseItem.growing, thing],
              },
        ),
      });

      console.log(`${thing} planted in ${name}.`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

greenhouse
  .command("adjust")
  .description("Adjust greenhouse conditions.")
  .argument("<name>", "greenhouse name")
  .option("--temperature <temperature>", "new temperature")
  .option("--humidity <humidity>", "new humidity")
  .option("--air-composition <airComposition>", "new air composition")
  .option("--light-level <lightLevel>", "new light level")
  .option("--integrity <integrity>", "new integrity")
  .action((name: string, options: Record<string, string | undefined>) => {
    try {
      const store = loadStore();
      const currentGreenhouse = requirePoweredGreenhouse(store, name);

      if (
        options.temperature === undefined &&
        options.humidity === undefined &&
        options.airComposition === undefined &&
        options.lightLevel === undefined &&
        options.integrity === undefined
      ) {
        console.error("Provide at least one greenhouse setting to adjust.");
        process.exitCode = 1;
        return;
      }

      saveStore({
        ...store,
        greenhouses: store.greenhouses.map((greenhouseItem) =>
          greenhouseItem.name !== name
            ? greenhouseItem
            : {
                ...currentGreenhouse,
                temperature:
                  options.temperature === undefined
                    ? currentGreenhouse.temperature
                    : Number(options.temperature),
                humidity:
                  options.humidity === undefined ? currentGreenhouse.humidity : Number(options.humidity),
                airComposition: options.airComposition ?? currentGreenhouse.airComposition,
                lightLevel: options.lightLevel ?? currentGreenhouse.lightLevel,
                integrity:
                  options.integrity === undefined ? currentGreenhouse.integrity : Number(options.integrity),
              },
        ),
      });

      console.log(`Greenhouse adjusted: ${name}`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

greenhouse
  .command("add-airlock")
  .description("Attach an airlock to a greenhouse.")
  .argument("<greenhouseName>", "greenhouse name")
  .argument("<airlockName>", "airlock name")
  .action((greenhouseName: string, airlockName: string) => {
    try {
      const store = loadStore();
      requireGreenhouse(store, greenhouseName);
      requireAirlock(store, airlockName);

      saveStore({
        ...store,
        greenhouses: store.greenhouses.map((greenhouseItem) =>
          greenhouseItem.name !== greenhouseName || greenhouseItem.airlockNames.includes(airlockName)
            ? greenhouseItem
            : {
                ...greenhouseItem,
                airlockNames: [...greenhouseItem.airlockNames, airlockName],
              },
        ),
      });

      console.log(`Airlock ${airlockName} attached to greenhouse ${greenhouseName}.`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

greenhouse
  .command("add-door")
  .description("Attach a door to a greenhouse.")
  .argument("<greenhouseName>", "greenhouse name")
  .argument("<doorName>", "door name")
  .action((greenhouseName: string, doorName: string) => {
    try {
      const store = loadStore();
      requireGreenhouse(store, greenhouseName);
      requireDoor(store, doorName);

      saveStore({
        ...store,
        greenhouses: store.greenhouses.map((greenhouseItem) =>
          greenhouseItem.name !== greenhouseName || greenhouseItem.doorNames.includes(doorName)
            ? greenhouseItem
            : {
                ...greenhouseItem,
                doorNames: [...greenhouseItem.doorNames, doorName],
              },
        ),
      });

      console.log(`Door ${doorName} attached to greenhouse ${greenhouseName}.`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

oxygenSystem
  .command("create")
  .description("Create an oxygen system.")
  .argument("<name>", "oxygen system name")
  .action((name: string) => {
    const store = loadStore();

    if (findOxygenSystem(store, name)) {
      console.error(`Oxygen system already exists: ${name}`);
      process.exitCode = 1;
      return;
    }

    saveStore({
      ...store,
      oxygenSystems: [...store.oxygenSystems, createOxygenSystem(name)],
    });

    console.log(`Oxygen system created: ${name}`);
  });

oxygenSystem
  .command("status")
  .description("Check an oxygen system.")
  .argument("<name>", "oxygen system name")
  .action((name: string) => {
    try {
      const store = loadStore();
      const currentOxygenSystem = requireOxygenSystem(store, name);
      console.log(JSON.stringify(currentOxygenSystem, null, 2));
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

oxygenSystem
  .command("generate")
  .description("Generate more oxygen from water.")
  .argument("<name>", "oxygen system name")
  .option("--amount <amount>", "oxygen amount to generate", "10")
  .action((name: string, options: { amount: string }) => {
    try {
      const store = loadStore();
      const currentOxygenSystem = requireOxygenSystem(store, name);
      const amount = Number(options.amount);

      saveStore({
        ...store,
        oxygenSystems: store.oxygenSystems.map((oxygenSystemItem) =>
          oxygenSystemItem.name !== name
            ? oxygenSystemItem
            : {
                ...currentOxygenSystem,
                oxygenLevel: Math.min(100, currentOxygenSystem.oxygenLevel + amount),
                airConcentration: Math.min(30, currentOxygenSystem.airConcentration + Math.ceil(amount / 10)),
              },
        ),
      });

      console.log(`Oxygen generated for ${name} from water.`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

oxygenSystem
  .command("fill-room")
  .description("Fill a room with oxygen.")
  .argument("<systemName>", "oxygen system name")
  .argument("<roomType>", "room type: airlock or greenhouse", parseRoomType)
  .argument("<roomName>", "room name")
  .action((systemName: string, roomType: RoomType, roomName: string) => {
    try {
      const store = loadStore();
      const currentOxygenSystem = requireOxygenSystem(store, systemName);

      if (currentOxygenSystem.oxygenLevel <= 0) {
        console.error(`Oxygen system ${systemName} is empty.`);
        process.exitCode = 1;
        return;
      }

      if (roomType === "airlock") {
        requireAirlock(store, roomName);

        saveStore({
          ...store,
          airlocks: store.airlocks.map((airlockItem) =>
            airlockItem.name !== roomName
              ? airlockItem
              : {
                  ...airlockItem,
                  airComposition: `oxygen-enriched (${currentOxygenSystem.airConcentration}%)`,
                },
          ),
          oxygenSystems: store.oxygenSystems.map((oxygenSystemItem) =>
            oxygenSystemItem.name !== systemName
              ? oxygenSystemItem
              : {
                  ...oxygenSystemItem,
                  oxygenLevel: Math.max(0, oxygenSystemItem.oxygenLevel - 10),
                },
          ),
        });

        console.log(`Filled airlock ${roomName} with oxygen from ${systemName}.`);
        return;
      }

      requireGreenhouse(store, roomName);

      saveStore({
        ...store,
        greenhouses: store.greenhouses.map((greenhouseItem) =>
          greenhouseItem.name !== roomName
            ? greenhouseItem
            : {
                ...greenhouseItem,
                airComposition: `oxygen-enriched (${currentOxygenSystem.airConcentration}%)`,
              },
        ),
        oxygenSystems: store.oxygenSystems.map((oxygenSystemItem) =>
          oxygenSystemItem.name !== systemName
            ? oxygenSystemItem
            : {
                ...oxygenSystemItem,
                oxygenLevel: Math.max(0, oxygenSystemItem.oxygenLevel - 10),
              },
        ),
      });

      console.log(`Filled greenhouse ${roomName} with oxygen from ${systemName}.`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

battery
  .command("create")
  .description("Create a battery.")
  .argument("<name>", "battery name")
  .action((name: string) => {
    const store = loadStore();

    if (findBattery(store, name)) {
      console.error(`Battery already exists: ${name}`);
      process.exitCode = 1;
      return;
    }

    saveStore({
      ...store,
      batteries: [...store.batteries, createBattery(name)],
    });

    console.log(`Battery created: ${name}`);
  });

battery
  .command("list")
  .description("List batteries.")
  .action(() => {
    const store = loadStore();

    if (store.batteries.length === 0) {
      console.log("No batteries found.");
      return;
    }

    for (const currentBattery of store.batteries) {
      console.log(currentBattery.name);
    }
  });

battery
  .command("show")
  .description("Show a battery.")
  .argument("<name>", "battery name")
  .action((name: string) => {
    try {
      const store = loadStore();
      console.log(JSON.stringify(requireBattery(store, name), null, 2));
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

battery
  .command("update")
  .description("Update a battery.")
  .argument("<name>", "battery name")
  .option("--charge <charge>", "battery charge amount")
  .option("--charging <charging>", "battery charging state: true or false")
  .action((name: string, options: { charge?: string; charging?: string }) => {
    try {
      const store = loadStore();
      const currentBattery = requireBattery(store, name);

      if (options.charge === undefined && options.charging === undefined) {
        console.error("Provide --charge and/or --charging.");
        process.exitCode = 1;
        return;
      }

      saveStore({
        ...store,
        batteries: store.batteries.map((batteryItem) =>
          batteryItem.name !== name
            ? batteryItem
            : {
                ...currentBattery,
                chargeAmount:
                  options.charge === undefined ? currentBattery.chargeAmount : parsePositiveNumber(options.charge, "Charge"),
                isCharging:
                  options.charging === undefined ? currentBattery.isCharging : parseBoolean(options.charging),
              },
        ),
      });

      console.log(`Battery updated: ${name}`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

battery
  .command("delete")
  .description("Delete a battery.")
  .argument("<name>", "battery name")
  .action((name: string) => {
    const store = loadStore();

    if (!findBattery(store, name)) {
      console.error(`Battery not found: ${name}`);
      process.exitCode = 1;
      return;
    }

    saveStore({
      ...store,
      batteries: store.batteries.filter((batteryItem) => batteryItem.name !== name),
      powerSystems: store.powerSystems.map((powerSystemItem) => ({
        ...powerSystemItem,
        batteryNames: powerSystemItem.batteryNames.filter((batteryName) => batteryName !== name),
      })),
    });

    console.log(`Battery deleted: ${name}`);
  });

powerSystem
  .command("create")
  .description("Create a power system.")
  .argument("<name>", "power system name")
  .action((name: string) => {
    const store = loadStore();

    if (findPowerSystem(store, name)) {
      console.error(`Power system already exists: ${name}`);
      process.exitCode = 1;
      return;
    }

    saveStore({
      ...store,
      powerSystems: [...store.powerSystems, createPowerSystem(name)],
    });

    console.log(`Power system created: ${name}`);
  });

powerSystem
  .command("list")
  .description("List power systems.")
  .action(() => {
    const store = loadStore();

    if (store.powerSystems.length === 0) {
      console.log("No power systems found.");
      return;
    }

    for (const currentPowerSystem of store.powerSystems) {
      console.log(currentPowerSystem.name);
    }
  });

powerSystem
  .command("show")
  .description("Show a power system.")
  .argument("<name>", "power system name")
  .action((name: string) => {
    try {
      const store = loadStore();
      console.log(JSON.stringify(requirePowerSystem(store, name), null, 2));
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

powerSystem
  .command("update")
  .description("Update a power system name.")
  .argument("<name>", "power system name")
  .option("--rename <newName>", "new power system name")
  .action((name: string, options: { rename?: string }) => {
    try {
      const store = loadStore();
      requirePowerSystem(store, name);

      if (options.rename === undefined) {
        console.error("Provide --rename.");
        process.exitCode = 1;
        return;
      }

      if (findPowerSystem(store, options.rename)) {
        console.error(`Power system already exists: ${options.rename}`);
        process.exitCode = 1;
        return;
      }

      saveStore({
        ...store,
        powerSystems: store.powerSystems.map((powerSystemItem) =>
          powerSystemItem.name === name ? { ...powerSystemItem, name: options.rename as string } : powerSystemItem,
        ),
      });

      console.log(`Power system updated: ${name}`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

powerSystem
  .command("delete")
  .description("Delete a power system.")
  .argument("<name>", "power system name")
  .action((name: string) => {
    const store = loadStore();

    if (!findPowerSystem(store, name)) {
      console.error(`Power system not found: ${name}`);
      process.exitCode = 1;
      return;
    }

    saveStore({
      ...store,
      powerSystems: store.powerSystems.filter((powerSystemItem) => powerSystemItem.name !== name),
    });

    console.log(`Power system deleted: ${name}`);
  });

powerSystem
  .command("add-battery")
  .description("Attach a battery to a power system.")
  .argument("<systemName>", "power system name")
  .argument("<batteryName>", "battery name")
  .action((systemName: string, batteryName: string) => {
    try {
      const store = loadStore();
      requirePowerSystem(store, systemName);
      requireBattery(store, batteryName);

      saveStore({
        ...store,
        powerSystems: store.powerSystems.map((powerSystemItem) =>
          powerSystemItem.name !== systemName || powerSystemItem.batteryNames.includes(batteryName)
            ? powerSystemItem
            : {
                ...powerSystemItem,
                batteryNames: [...powerSystemItem.batteryNames, batteryName],
              },
        ),
      });

      console.log(`Battery ${batteryName} attached to power system ${systemName}.`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

powerSystem
  .command("power-room")
  .description("Assign a power system to power a room.")
  .argument("<systemName>", "power system name")
  .argument("<roomType>", "room type: airlock or greenhouse", parseRoomType)
  .argument("<roomName>", "room name")
  .option("--demand <demand>", "power demand for the room", "25")
  .action((systemName: string, roomType: RoomType, roomName: string, options: { demand: string }) => {
    try {
      const store = loadStore();
      const currentPowerSystem = requirePowerSystem(store, systemName);
      const demand = parsePositiveNumber(options.demand, "Demand");

      if (roomType === "airlock") {
        requireAirlock(store, roomName);
      } else {
        requireGreenhouse(store, roomName);
      }

      const nextStore = recalculatePowerState({
        ...store,
        powerSystems: store.powerSystems.map((powerSystemItem) =>
          powerSystemItem.name !== systemName
            ? powerSystemItem
            : {
                ...currentPowerSystem,
                roomsReceivingPower: [
                  ...currentPowerSystem.roomsReceivingPower.filter(
                    (room) => !(room.roomType === roomType && room.roomName === roomName),
                  ),
                  {
                    roomType,
                    roomName,
                    powerDemand: demand,
                  },
                ],
              },
        ),
      });

      const systemAfterUpdate = requirePowerSystem(nextStore, systemName);
      const totalDemand = systemAfterUpdate.roomsReceivingPower.reduce((sum, room) => sum + room.powerDemand, 0);

      saveStore(nextStore);

      if (systemAfterUpdate.totalPowerStored < totalDemand) {
        console.log(
          `Power demand is too high for ${systemName}. ${roomType} ${roomName} has been assigned but rooms are not powered.`,
        );
        return;
      }

      console.log(`Power system ${systemName} is now powering ${roomType} ${roomName} with demand ${demand}.`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

program.on("command:*", ([commandName]) => {
  console.error(`Unknown command: ${commandName}`);
  console.error("Try `habitat --help` to see the available commands.");
  process.exitCode = 1;
});

program.parse(process.argv);
