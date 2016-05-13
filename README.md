# UDT

A pure JavaScript implementation of UDP-based Data Transfer Protocol called UDT for Node.JS.
It has the special purpose of real-time action game servers in mind but could of course be used for anything!

In the long term this project is planned to be the basis for network communication in a full-blown open source MMO Node.JS clustered server framework. For this reason rate control and congestion control are not implemented because fast response is a priority. However, it would be nice to have optional congestion control in the future.

# Why would I use Node.Js on my realtime game server?

The main reason is because it's quick and easy to code. The second reason is because it uses a single thread yet is oriented around non-blocking I/O. Writing and maintaining servers especially with multiple threads is a difficult task. Using Node.JS asynchronous code simplifies both development and maintenance of complex network server software. Furthermore the Java port of UDT uses multi-threading and so is more difficult to debug.

# But what about performance? Surely C++ would be a better solution than javascript?

This part of your server will not be bound by *CPU* performance, it will be bound by *I/O*. Thus, it makes more sense to use a language like Node.JS which excels at providing I/O bound solutions (as it is many MMO servers are written in *Java*, which we all know is even slower). Besides, because node typically runs on a single core, that frees up cores for more complex CPU intensive tasks such as simulating physics in a real-time game.

Native C++ will use a smaller memory footprint and be slightly faster overall than the V8 engine (which is very fast), but we believe the tradeoffs such as built-in garbage collection, no pointers, proven scalability, readily available developers internationally, and a single cross-platform code base is worth seriously considering this as a solution especially when considering native code execution speed is not really required on an MMO server.

# Status

This implementation is not yet in a usable state.

Current tasks: Receiver and sender logic

# Installation

Requires Node.Js >= 6.0.0

    cd yourprojectdir
    npm install rocifier/udt

To run tests:
    
    mocha

To debug tests use `debugger;` statements in code as breakpoints for iron-node:

    npm run debug-mocha
    
This project uses ESLint for error checking, conventions, and style guide rules. The configuration for ESLint is inside package.json

# Usage

Note: You must handle your own dns resolution if required. To host from localhost use 127.0.0.1 or to host from all addresses use 0.0.0.0

# Overview of implementation

This implementation is based directly off the draft spec at http://udt.sourceforge.net/doc/draft-gg-udt-03.txt

## Server

Essentially a wrapper which establishes a listening EndPoint but exists to mimic the nodejs 'net' interface.
When a client connects to the server, the server emits an event 'connection' and supplies a new UDT socket
for that connection which can be read or written to by your app. Your app must store and track these sockets itself.

## EndPoint

Provides most of the UDT protocol implementation including handshaking and handling a full range of packet types.
Does all the low-level decoding of packet headers. Interfaces with congestion control, automatically retransmits lost
packets, and sends official shut down packets when it's shut down.

### Packets

UDT always tries to pack application data into fixed size packets (the maximum packet size negotiated during handshaking), unless there is not enough data to be sent.

## Socket

A socket is a link between local endpoint and destination address. Every link between two endpoints will have its own unique socket. A socket is how you can read or write data to a remote address.

A client establishes its endpoint and passes this to a socket instructing it to connect to a remote address, which initiates handshaking on the endpoint.
A server instances a Server, which sets up a single listening endpoint that will later create multiple sockets upon successful handshaking. So an endpoint references multiple sockets.
