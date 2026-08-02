import AsyncStorage from '@react-native-async-storage/async-storage';

export type FuelRecord = {
  id: string;
  createdAt: number;
  date: string;
  fuelType: string;
  price: number;
  amount: number;
  liters: number;
  mileage: number;
  fullTank: boolean;
};

export type ExpenseRecord = {
  id: string;
  createdAt: number;
  date: string;
  amount: number;
  category: string;
  note: string;
};

export type FuelwiseData = {
  fuelRecords: FuelRecord[];
  expenseRecords: ExpenseRecord[];
  settings: {
    ownerName: string;
  };
};

const STORAGE_KEY = 'fuelwise-data-v1';

export const emptyData = (): FuelwiseData => ({
  fuelRecords: [],
  expenseRecords: [],
  settings: { ownerName: '车主' },
});

export async function loadData(): Promise<FuelwiseData> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw);
    return {
      ...emptyData(),
      ...parsed,
      settings: { ownerName: parsed.settings?.ownerName || '车主' },
    };
  } catch {
    return emptyData();
  }
}

export async function saveData(data: FuelwiseData) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
