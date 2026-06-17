import { AxeBuilder } from '@axe-core/playwright';

export async function runAxe(page) {
  try {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
      
    return results.violations;
  } catch (error) {
    console.error('Axe execution failed:', error);
    return [];
  }
}
