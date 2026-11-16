import { getAppConfig } from "./config";
import { getHolidayScheduleSnapshot, type HolidayScheduleSnapshot } from "./holidays";

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
                queryOnlyOnOff: true,
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
      const getSnapshot = deps?.getSnapshot ?? (() => getHolidayScheduleSnapshot());
      const snapshot = await getSnapshot();
      const requestedDevices = primaryInput.payload?.devices ?? [{ id: config.deviceId }];
      const devicesResponse: Record<string, Record<string, unknown>> = {};

      for (const dev of requestedDevices) {
        if (dev.id === config.deviceId) {
          devicesResponse[dev.id] = {
            online: true,
            status: "SUCCESS",
            on: snapshot.current.isOn,
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
      const ids = Array.from(
        new Set(commandEntries.flatMap((cmd) => cmd.devices.map((d) => d.id))),
      );
      return {
        requestId,
        payload: {
          commands:
            ids.length > 0
              ? [
                  {
                    ids,
                    status: "ERROR",
                    errorCode: "notSupported",
                  },
                ]
              : [],
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
