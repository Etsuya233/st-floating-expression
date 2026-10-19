import { readFileSync } from 'node:fs';

// Load the REAL detection code out of index.js (it imports SillyTavern
// modules, so it cannot be imported directly) and stub its dependencies.
const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const start = src.indexOf('//  Detection\n');
const end = src.indexOf('//  Sprite Resolution');
if (start < 0 || end < 0) throw new Error('section markers not found');
const section = src.slice(src.lastIndexOf('// =====', start), end);

const settings = {
    detectionMode: 'html', htmlTagName: 'expression',
    regexPattern: '\\[expression[：:](.+?)\\]',
};
const load = new Function('getSettings', `
    const EXTENSION_NAME = 'test';
    ${section}
    return { detectExpression, detectByHtmlTag, detectByRegex, buildHideTagRegex };
`)(() => settings);

const { detectExpression, buildHideTagRegex } = load;

let pass = 0, fail = 0;
function t(name, text, expected, mode = 'html') {
    settings.detectionMode = mode;
    const got = detectExpression(text);
    const ok = got === expected;
    ok ? pass++ : fail++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}\n         got=${JSON.stringify(got)} want=${JSON.stringify(expected)}`);
}

console.log('── HTML tag mode ──');
t('plain tag', '你好呀！\n<expression>joy</expression>', 'joy');
t('multi-line tag (ea2aa6e regression)',
    '你好呀！\n<expression>\nhappy\n</expression>', 'happy');
t('CoT mentions the open tag only — the reported bug',
    '<think>用户想要开心表情。按照要求生成<expression>标签，我会先构思台词。\n好，我选择 happy 这个表情。</think>\n台词写完了。\n<expression>happy</expression>', 'happy');
t('CoT writes a complete fake pair first',
    '思考：是否应该用<expression>sad</expression>？不，还是开心吧。\n<expression>happy</expression>', 'happy');
t('expression changes twice — last wins',
    '一开始\n<expression>neutral</expression>\n现在\n<expression>joy</expression>', 'joy');
t('CoT open tag + real tag on the SAME line (permissive fallback)',
    '按照要求生成<expression>标签，然后输出 <expression>joy</expression>', 'joy');
t('tag with attributes', '文本\n<expression class="emotion" data-x="1">joy</expression>', 'joy');
t('uppercase label', '<EXPRESSION>Joy</EXPRESSION>', 'joy');
t('markdown bolded label', '**<expression>joy</expression>**', 'joy');
t('no tag at all', '今天天气不错。', null);
t('unclosed tag only — nothing to hide', '<expression>joy', null);

console.log('\n── Regex mode (default pattern) ──');
t('CoT mentions the label first', '思考：要不要写[expression：sad]？\n不，[expression：joy]', 'joy', 'regex');
t('plain', '[expression:Joy]', 'joy', 'regex');
t('CoT full-width colon', '[expression：joy]', 'joy', 'regex');

console.log('\n── Hide-tag regex ──');
settings.detectionMode = 'html';
const hide = buildHideTagRegex();
console.log('  pattern:', hide);
const hideCases = [
    ['plain', '你好\n<expression>joy</expression>再见', '你好\n再见'],
    ['multi-line', '你好\n<expression>\nhappy\n</expression>再见', '你好\n再见'],
    ['CoT open tag must NOT eat the body',
        '思考：按照要求生成<expression>标签。\n台词写完了。\n<expression>happy</expression>',
        '思考：按照要求生成<expression>标签。\n台词写完了。\n'],
    ['all tags hidden', '<expression>a</expression>和<expression>b</expression>', '和'],
    ['empty body', 'x<expression></expression>y', 'xy'],
];
for (const [name, input, want] of hideCases) {
    const got = input.replace(new RegExp(hide, 'g'), '');
    const ok = got === want;
    ok ? pass++ : fail++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}\n         got=${JSON.stringify(got)}\n        want=${JSON.stringify(want)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);