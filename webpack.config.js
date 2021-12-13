const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const prod = process.env.NODE_ENV === 'production'
module.exports = {
    mode: process.env.NODE_ENV,
    entry: {
        app: path.resolve(__dirname, './src/main.js')
    },
    output: {
        path: path.resolve(__dirname, './dist'),
        publicPath: '/',
    },
    resolve: {
        alias: {
            '@src': path.resolve(__dirname, './src'),
            '@': path.resolve(__dirname, './src'),
        }
    },
    devtool: prod ? false : 'source-map',
    module: {
        rules: [
            {
                test: /\.m?jsx?$/,
                exclude: /node_modules/,
                use: [{
                    loader: 'babel-loader',
                    options: {
                        "presets": [
                            [
                                "@babel/preset-env",
                                {
                                    "modules": "commonjs",
                                }
                            ]
                        ],
                        "plugins": [
                            ["@babel/plugin-transform-runtime", {corejs: 3}],
                        ]
                    }
                }],
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            }
        ]
    },
    devServer: {
        port: 8888,
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: path.resolve(__dirname, './public/index.html'),
            title: '知识图谱'
        })
    ]
}
