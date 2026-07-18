import { groupGreetings } from './group/index.mjs'
import { signalGreetings } from './signal/index.mjs'

export async function GetGreeting(args, index) {
	return (await signalGreetings(args))[index]
}

export async function GetGroupGreeting(args, index) {
	return (await groupGreetings(args))[index]
}
