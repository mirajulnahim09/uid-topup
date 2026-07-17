import { prisma } from './prisma';

export async function getSettings(): Promise<Record<string, string>> {
  try {
    const rows = await prisma.setting.findMany();
    if (!Array.isArray(rows)) return {};
    return Object.fromEntries(rows.map((r: (typeof rows)[number]) => [r.key, r.value]));
  } catch {
    return {};
  }
}

export async function getSetting(key: string, fallback = ''): Promise<string> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}
