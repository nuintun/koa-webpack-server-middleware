import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';

const targets = { browsers: ['defaults'] };
const corejs = { version: '^3.0.0', proposals: true };

export default [
  {
    input: 'src/client/index.js',
    output: {
      format: 'esm',
      file: 'client.js'
    },
    plugins: [
      resolve(),
      babel({
        babelHelpers: 'bundled',
        presets: [
          [
            '@babel/preset-env',
            {
              corejs,
              targets,
              bugfixes: true,
              useBuiltIns: 'usage'
            }
          ]
        ]
      })
    ],
    external: ['ansi-html', 'html-entities', /core-js/]
  },
  {
    input: 'src/server/index.js',
    output: {
      format: 'cjs',
      interop: false,
      exports: 'auto',
      file: 'index.js',
      preferConst: true
    },
    plugins: [resolve()],
    external: ['ws', 'webpack', 'koa-compose', 'memoize-one', 'webpack-dev-middleware']
  }
];
