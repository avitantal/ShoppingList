import { describe, expect, it } from 'vitest';
import {
  DEPARTMENT_CODES,
  DEPARTMENTS,
  DEPARTMENT_BY_CODE,
  classifyItem,
  classifyToDepartmentCode,
} from '../../lib/departments';

describe('classifyItem', () => {
  it.each<[string, string]>([
    ['חלב תנובה 3% 1 ליטר', DEPARTMENT_CODES.DAIRY],
    ['קוטג 5% תנובה', DEPARTMENT_CODES.DAIRY],
    ['גבינה לבנה 5%', DEPARTMENT_CODES.DAIRY],
    ['ביצים L 12 יחידות', DEPARTMENT_CODES.DAIRY],
    ['שוקו פחית 500 מ"ל', DEPARTMENT_CODES.DAIRY],

    ['עגבניות שרי 500 גרם', DEPARTMENT_CODES.PRODUCE],
    ['בננה', DEPARTMENT_CODES.PRODUCE],
    ['אבוקדו האס', DEPARTMENT_CODES.PRODUCE],
    ['חסה אורגנית', DEPARTMENT_CODES.PRODUCE],

    ['לחם אחיד פרוס', DEPARTMENT_CODES.BAKERY],
    ['פיתות 10 יחידות', DEPARTMENT_CODES.BAKERY],
    ['חלה משפחתית', DEPARTMENT_CODES.BAKERY],

    ['חזה עוף טרי', DEPARTMENT_CODES.MEAT_FISH],
    ['בשר טחון 500 גרם', DEPARTMENT_CODES.MEAT_FISH],
    ['סלמון נורווגי', DEPARTMENT_CODES.MEAT_FISH],

    ['נקניק שווייצרי', DEPARTMENT_CODES.DELI],
    ['פסטרמת הודו', DEPARTMENT_CODES.DELI],

    ['אורז יסמין 1 ק"ג', DEPARTMENT_CODES.PANTRY],
    ['פסטה ספגטי', DEPARTMENT_CODES.PANTRY],
    ['קמח חיטה לבן 1 ק"ג', DEPARTMENT_CODES.PANTRY],
    ['שמן זית כתית', DEPARTMENT_CODES.PANTRY],
    ['טונה בשמן', DEPARTMENT_CODES.PANTRY],

    ['במבה אסם', DEPARTMENT_CODES.SNACKS],
    ['ביסלי ברביקיו', DEPARTMENT_CODES.SNACKS],
    ['שוקולד מריר 70%', DEPARTMENT_CODES.SNACKS],
    ['חלבה ללא סוכר', DEPARTMENT_CODES.SNACKS],
    ['טיק טק מנטה', DEPARTMENT_CODES.SNACKS],

    ['קוקה קולה 1.5 ליטר', DEPARTMENT_CODES.BEVERAGES],
    ['מיץ תפוזים סחוט', DEPARTMENT_CODES.BEVERAGES],
    ['קפה טורקי 200 גרם', DEPARTMENT_CODES.BEVERAGES],
    ['חליטת קמומיל', DEPARTMENT_CODES.BEVERAGES],

    ['בירה גולדסטאר', DEPARTMENT_CODES.ALCOHOL],
    ['יין אדום קברנה', DEPARTMENT_CODES.ALCOHOL],
    ['וודקה אבסולוט', DEPARTMENT_CODES.ALCOHOL],

    ['גלידת וניל', DEPARTMENT_CODES.FROZEN],
    ['קרפלך במילוי תפו"א', DEPARTMENT_CODES.FROZEN],

    ['נייר טואלט 32 גלילים', DEPARTMENT_CODES.CLEANING],
    ['אקונומיקה לימון', DEPARTMENT_CODES.CLEANING],
    ['אבקת כביסה אריאל', DEPARTMENT_CODES.CLEANING],
    ['ספוג כלים', DEPARTMENT_CODES.CLEANING],

    ['שמפו פנטן', DEPARTMENT_CODES.PERSONAL_CARE],
    ['משחת שיניים קולגייט', DEPARTMENT_CODES.PERSONAL_CARE],
    ['קרם ידיים ניוואה', DEPARTMENT_CODES.PERSONAL_CARE],
    ['דאודורנט דאב', DEPARTMENT_CODES.PERSONAL_CARE],

    ['חיתולים האגיס מידה 4', DEPARTMENT_CODES.BABY],
    ['מטרנה שלב 2', DEPARTMENT_CODES.BABY],
  ])('classifies %j as %s', (name, expected) => {
    expect(classifyToDepartmentCode(name)).toBe(expected);
  });

  describe('false-positive regressions', () => {
    // Each line below is a real product name that previously triggered a
    // wrong rule. Keep them as guardrails when adding new keywords.
    it.each<[string, string]>([
      // 'טרה' (dairy brand) used to match 'אקסטרה'
      ['נמס בכוס אקסטרה', DEPARTMENT_CODES.BEVERAGES],
      // 'גיל' (dropped) used to match 'אביגיל' (disposable tray)
      ['מגש אביגיל שקוף', DEPARTMENT_CODES.UNCLASSIFIED],
      // 'דאב' (Dove) used to match 'דאבל' (Lindor Double)
      ['לינדט לינדור דאבל', DEPARTMENT_CODES.SNACKS],
      // 'תער' used to match 'תערובת' (baking mix)
      ['תערובת להכנת קרם פטיסייר', DEPARTMENT_CODES.PANTRY],
      // 'שוקולד' used to be cancelled by 'שוקו' substring — DAIRY won
      ['שוקולד מריר 85%', DEPARTMENT_CODES.SNACKS],
      // 'נפוליאון' (cheese) used to match 'נפוליאון פלפלים' (pickled peppers
      // brand) and send it to DAIRY. Now correctly hits PRODUCE via 'פלפל'.
      ['נפוליאון פלפלים פיקנטיים', DEPARTMENT_CODES.PRODUCE],
      // 'עלית' (dropped as brand) used to win over 'קפה'
      ['קפה טורקי 200 גרם עלית', DEPARTMENT_CODES.BEVERAGES],
      // 'חלבה' used to lose to 'סוכר' on equal length
      ['חלבה 400 גרם ללא סוכר', DEPARTMENT_CODES.SNACKS],
      // 'פטה' used to match dog food
      ['וונפי שימורי כלב פטה', DEPARTMENT_CODES.UNCLASSIFIED],
      // 'ביצה' used to match 'בצק משחק -ביצה' (play dough)
      ['בצק משחק -ביצה', DEPARTMENT_CODES.UNCLASSIFIED],
    ])('keeps %j out of trouble (→ %s)', (name, expected) => {
      expect(classifyToDepartmentCode(name)).toBe(expected);
    });
  });

  it('returns unclassified for empty / nullish input', () => {
    expect(classifyToDepartmentCode('')).toBe(DEPARTMENT_CODES.UNCLASSIFIED);
    expect(classifyToDepartmentCode(null)).toBe(DEPARTMENT_CODES.UNCLASSIFIED);
    expect(classifyToDepartmentCode(undefined)).toBe(DEPARTMENT_CODES.UNCLASSIFIED);
    expect(classifyToDepartmentCode('   ')).toBe(DEPARTMENT_CODES.UNCLASSIFIED);
  });

  it('strips Hebrew niqqud before matching', () => {
    expect(classifyToDepartmentCode('חָלָב 3%')).toBe(DEPARTMENT_CODES.DAIRY);
  });

  it('reports the rule that matched', () => {
    const result = classifyItem('חלב תנובה');
    expect(result.department).toBe(DEPARTMENT_CODES.DAIRY);
    expect(result.matchedRule).toBeTruthy();
  });
});

describe('DEPARTMENTS metadata', () => {
  it('exposes all codes through DEPARTMENT_BY_CODE', () => {
    for (const code of Object.values(DEPARTMENT_CODES)) {
      expect(DEPARTMENT_BY_CODE[code]).toBeDefined();
      expect(DEPARTMENT_BY_CODE[code].code).toBe(code);
    }
  });

  it('orders departments by shopping-route order', () => {
    const orders = DEPARTMENTS.map((d) => d.order);
    const sorted = [...orders].sort((a, b) => a - b);
    expect(orders).toEqual(sorted);
  });
});
