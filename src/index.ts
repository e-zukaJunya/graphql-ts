import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@apollo/server/express4'
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer'
import { makeExecutableSchema } from '@graphql-tools/schema'
// import { AppSyncResolverEvent, Context } from 'aws-lambda'
import bodyParser from 'body-parser'
import cors, { CorsRequest } from 'cors'
import express from 'express'
import { PubSub } from 'graphql-subscriptions'
import { useServer } from 'graphql-ws/lib/use/ws'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'

const PORT = 4000
const pubsub = new PubSub()

// Schema definition
const typeDefs = `#graphql
    type Query {
        books: [Book]
        #sample(param: SampleInput): SampleOutput
    }

    type Mutation {
        addBook(title: String!, author: String): Book!
    }

    type Subscription {
        # numberIncremented: Int
        onAddBook: Book!
    }
    input SampleInput {
        param1: String!
    }
    type SampleOutput {
        id: Int!
        name: String
    }
    type Book {
        title: String!
        author: String
    }
`

const ON_ADD_BOOK = 'ON_ADD_BOOK'
const books = [
    {
        title: 'Harry Potter and the Chamber of Secrets',
        author: 'J.K. Rowling',
    },
    {
        title: 'Jurassic Park',
        author: 'Michael Crishton',
    },
]

// // Lambda用のハンドラーをApollo用にラップする
// const apolloHandler = async <T, U>(
//     param: T,
//     handler: (event: AppSyncResolverEvent<T, unknown>, context: Context) => Promise<U>,
// ) => {
//     const event = {
//         arguments: param,
//     } as unknown as AppSyncResolverEvent<T, unknown>
//     const context = { functionName: '' } as Context

//     // 実際の処理の実行
//     const res = await handler(event, context)
//     return res
// }

// const graphqlSample = (param: typeof graphqlSampleReq._type) => apolloHandler(param, GraphqlSample.handler)

// Resolver map
const resolvers = {
    Query: {
        books: () => books,
        // sample: (parent: any, args: any, context: any, info: any) => graphqlSample(args.param),
    },
    Mutation: {
        addBook: (parent: any, args: any, context: any, info: any) => {
            const newBook = { title: args.title, author: args.author }
            books.push(newBook)

            // サブスクリプションを発行する
            pubsub.publish(ON_ADD_BOOK, { onAddBook: newBook })

            return newBook
        },
    },
    Subscription: {
        onAddBook: {
            subscribe: () => pubsub.asyncIterator([ON_ADD_BOOK]),
        },
    },
}

// Create schema, which will be used separately by ApolloServer and
// the WebSocket server.
const schema = makeExecutableSchema({ typeDefs, resolvers })

// Create an Express app and HTTP server; we will attach the WebSocket
// server and the ApolloServer to this HTTP server.
const app = express()
const httpServer = createServer(app)

// Set up WebSocket server.
const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/',
    handleProtocols: (protocols) => {
        console.log('Protocols:', protocols)

        return Array.from(protocols).includes('graphql-ws') ? 'graphql-ws' : null
    },
})
const serverCleanup = useServer({ schema }, wsServer)

// Set up ApolloServer.
const server = new ApolloServer({
    schema,
    plugins: [
        // Proper shutdown for the HTTP server.
        ApolloServerPluginDrainHttpServer({ httpServer }),

        // Proper shutdown for the WebSocket server.
        {
            async serverWillStart() {
                return {
                    async drainServer() {
                        await serverCleanup.dispose()
                    },
                }
            },
        },
    ],
})

async function startApolloServer(server: ApolloServer<any>) {
    try {
        await server.start()
        app.use('/', cors<CorsRequest>(), bodyParser.json(), expressMiddleware(server))

        // Now that our HTTP server is fully set up, actually listen.
        httpServer.listen(PORT, () => {
            console.log(`🚀 Query/Mutation endpoint ready at http://localhost:${PORT}/`)
            console.log(`🚀 Subscription endpoint ready at ws://localhost:${PORT}/`)
        })
    } catch (e) {
        console.error(e)
    }
}
startApolloServer(server)
