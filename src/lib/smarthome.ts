import { getAppConfig } from "./config";
import { getHolidayScheduleSnapshot, type HolidayScheduleSnapshot } from "./holidays";
import { getSwitchOverride, type SwitchOverride } from "./override";

export interface SmartHomeInput {
  intent: string;
  payload?: {
    devices?: Array<{ id: string; customData?: Record<string, unknown> }>;
    commands?: Array<{
      devices: Array<{ id: string }>;
      execution: Array<{ command: string; params?: Record<string, unknown> }>;
    }>;
  };
}

export interface SmartHomeRequest {
  requestId: string;
  inputs: SmartHomeInput[];
}

export interface SmartHomeDeps {
  getSnapshot?: () => Promise<HolidayScheduleSnapshot>;
  getOverride?: () => Promise<SwitchOverride | null>;
}

async function getEffectiveSwitchState(deps?: SmartHomeDeps): Promise<boolean> {
  const getSnapshot = deps?.getSnapshot ?? (() => getHolidayScheduleSnapshot());
  const getOverride = deps?.getOverride ?? (() => getSwitchOverride());
  const [snapshot, override] = await Promise.all([getSnapshot(), getOverride()]);
  return override ? override.isOn : snapshot.current.isOn;
}

export async function handleSmartHomeIntent(
  body: SmartHomeRequest,
  deps?: SmartHomeDeps,
): Promise<Record<string, unknown>> {
  const config = getAppConfig();
  const requestId = body.requestId;
  const primaryInput = body.inputs?.[0];

  if (!requestId || !primaryInput?.intent) {
    return {
      requestId: requestId || "unknown",
      payload: {
        errorCode: "protocolError",
      },
    };
  }

  switch (primaryInput.intent) {
    case "action.devices.SYNC": {
      return {
        requestId,
        payload: {
          agentUserId: config.agentUserId,
          devices: [
            {
              id: config.deviceId,
              type: "action.devices.types.SWITCH",
              traits: ["action.devices.traits.OnOff"],
              name: {
                defaultNames: ["School Holidays Switch"],
                name: config.deviceName,
                nicknames: ["Vacances scolaires", "School holidays", "Vacances Zone C"],
              },
              willReportState: true,
              attributes: {
                commandOnlyOnOff: false,
                queryOnlyOnOff: false,
              },
              deviceInfo: {
                manufacturer: "Zone C Calendar Bridge",
                model: "FR School Holidays Virtual Switch",
                hwVersion: "1.0",
                swVersion: "1.0",
              },
            },
          ],
        },
      };
    }

    case "action.devices.QUERY": {
      const effectiveIsOn = await getEffectiveSwitchState(deps);
      const requestedDevices = primaryInput.payload?.devices ?? [{ id: config.deviceId }];
      const devicesResponse: Record<string, Record<string, unknown>> = {};

      for (const dev of requestedDevices) {
        if (dev.id === config.deviceId) {
          devicesResponse[dev.id] = {
            online: true,
            status: "SUCCESS",
            on: effectiveIsOn,
          };
        } else {
          devicesResponse[dev.id] = {
            online: false,
            status: "ERROR",
            errorCode: "deviceNotFound",
          };
        }
      }

      return {
        requestId,
        payload: {
          devices: devicesResponse,
        },
      };
    }

    case "action.devices.EXECUTE": {
      const commandEntries = primaryInput.payload?.commands ?? [];
      const requestedIds = Array.from(
        new Set(commandEntries.flatMap((cmd) => cmd.devices.map((d) => d.id))),
      );
      const knownIds = requestedIds.filter((id) => id === config.deviceId);
      const unknownIds = requestedIds.filter((id) => id !== config.deviceId);
      const commands: Array<Record<string, unknown>> = [];

      if (knownIds.length > 0) {
        const effectiveIsOn = await getEffectiveSwitchState(deps);
        commands.push({
          ids: knownIds,
          status: "SUCCESS",
          states: {
            online: true,
            on: effectiveIsOn,
          },
        });
      }

      if (unknownIds.length > 0) {
        commands.push({
          ids: unknownIds,
          status: "ERROR",
          errorCode: "deviceNotFound",
        });
      }

      return {
        requestId,
        payload: {
          commands,
        },
      };
    }

    case "action.devices.DISCONNECT": {
      return {};
    }

    default: {
      return {
        requestId,
        payload: {
          errorCode: "notSupported",
        },
      };
    }
  }
}
