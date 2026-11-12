/* Global test doubles for native modules that have no JS implementation. */

jest.mock("react-native-mmkv", () => {
  const instances = new Map<string, Map<string, string | number | boolean>>();
  const create = ({ id = "default" }: { id?: string } = {}) => {
    const data = instances.get(id) ?? new Map();
    instances.set(id, data);
    return {
      getString: (key: string) => {
        const value = data.get(key);
        return typeof value === "string" ? value : undefined;
      },
      getNumber: (key: string) => {
        const value = data.get(key);
        return typeof value === "number" ? value : undefined;
      },
      getBoolean: (key: string) => {
        const value = data.get(key);
        return typeof value === "boolean" ? value : undefined;
      },
      set: (key: string, value: string | number | boolean) => data.set(key, value),
      contains: (key: string) => data.has(key),
      remove: (key: string) => data.delete(key),
      delete: (key: string) => data.delete(key),
      getAllKeys: () => [...data.keys()],
      clearAll: () => data.clear(),
      recrypt: () => undefined,
    };
  };
  return { createMMKV: create, MMKV: create };
});

jest.mock("expo-secure-store", () => {
  const data = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      data.delete(key);
    }),
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  };
});
