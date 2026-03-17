/**
 * EvoClaw provider ID → PI provider ID 映射
 *
 * PI 框架（pi-ai）的 KnownProvider 与 EvoClaw 自定义的 provider ID 有差异，
 * 需要在调用 PI ModelRegistry / 构造 PI Model 对象时转换。
 *
 * 映射规则：
 * - 大部分 provider ID 一致（openai, anthropic, google, groq 等）
 * - 智谱 GLM: EvoClaw 用 "glm"，PI 用 "zai"
 * - 未来可按需扩展
 */

const EVOCLAW_TO_PI: Record<string, string> = {
  glm: 'zai',
};

const PI_TO_EVOCLAW: Record<string, string> = {
  zai: 'glm',
};

/** EvoClaw provider ID → PI provider ID（未匹配则原样返回） */
export function toPIProvider(evoClawId: string): string {
  return EVOCLAW_TO_PI[evoClawId] ?? evoClawId;
}

/** PI provider ID → EvoClaw provider ID（未匹配则原样返回） */
export function toEvoClawProvider(piId: string): string {
  return PI_TO_EVOCLAW[piId] ?? piId;
}
