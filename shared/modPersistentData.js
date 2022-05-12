const sqlite = require( "sqlite3" ).verbose()
const fs = require( "fs" )
const crypto = require( "crypto" )
const TOKEN_EXPIRATION_TIME = 3600000 * 24 // 24 hours

const DEFAULT_PDATA_BASELINE = fs.readFileSync( "default.pdata" )
const path = require( "path" )
const pjson = require( path.join( __dirname, "../shared/pjson.js" ) )
const DEFAULT_PDEF_OBJECT = pjson.ParseDefinition( fs.readFileSync( "persistent_player_data_version_231.pdef" ).toString() )

const dbSchemaRaw = fs.readFileSync( "./dbSchema.json" )
const dbSchema = JSON.parse( dbSchemaRaw )

let playerDB = new sqlite.Database( "playerdata.db", sqlite.OPEN_CREATE | sqlite.OPEN_READWRITE, async ex =>
{
	if ( ex )
		console.error( ex )
	else
		console.log( "Connected to player database successfully" )

	// create account table
	// this should mirror the PlayerAccount class's	properties
	playerDB.run( `
	CREATE TABLE IF NOT EXISTS accounts (
		${ dbSchema.accounts.columns.map( ( col ) =>
	{
		return `${col.name} ${col.type} ${col.modifier ? col.modifier : ""}`
	} ).join( ",\n\r\t\t" ) }
		${ dbSchema.accounts.extra ? ","+dbSchema.accounts.extra : "" }
	)
	`, ex =>
	{
		if ( ex )
			console.error( ex )
		else
			console.log( "Created player account table successfully" )
	} )

	// create mod persistent data table
	// this should mirror the PlayerAccount class's	properties
	playerDB.run( `
	CREATE TABLE IF NOT EXISTS modPersistentData (
		${ dbSchema.modPersistentData.columns.map( ( col ) =>
	{
		return `${col.name} ${col.type} ${col.modifier ? col.modifier : ""}`
	} ).join( ",\n\r\t\t" ) }
		${ dbSchema.modPersistentData.extra ? ","+dbSchema.modPersistentData.extra : "" }
	)
	`, ex =>
	{
		if ( ex )
			console.error( ex )
		else
			console.log( "Created mod persistent data table successfully" )
	} )

	for ( const col of dbSchema.accounts.columns )
	{
		if( !await columnExists( "accounts", col.name ) )
		{
			console.log( `The 'accounts' table is missing the '${col.name}' column` )
			await addColumnToTable( "accounts", col )
		}
	}
	for ( const col of dbSchema.modPersistentData.columns )
	{
		if( !await columnExists( "modPersistentData", col.name ) )
		{
			console.log( `The 'modPersistentData' table is missing the '${col.name}' column` )
			await addColumnToTable( "modPersistentData", col )
		}
	}
} )

function asyncDBGet( sql, params = [] )
{
	return new Promise( ( resolve, reject ) =>
	{
		playerDB.get( sql, params, ( ex, row ) =>
		{
			if ( ex )
			{
				console.error( "Encountered error querying player database: " + ex )
				reject( ex )
			}
			else
				resolve( row )
		} )
	} )
}

function asyncDBAll( sql, params = [] )
{
	return new Promise( ( resolve, reject ) =>
	{
		playerDB.all( sql, params, ( ex, row ) =>
		{
			if ( ex )
			{
				console.error( "Encountered error querying player database: " + ex )
				reject( ex )
			}
			else
				resolve( row )
		} )
	} )
}


function asyncDBRun( sql, params = [] )
{
	return new Promise( ( resolve, reject ) =>
	{
		playerDB.run( sql, params, ex =>
		{
			if ( ex )
			{
				console.error( "Encountered error querying player database: " + ex )
				reject( ex )
			}
			else
				resolve()
		} )
	} )
}

function columnExists( tableName, colName )
{
	return new Promise( ( resolve, reject ) =>
	{
		playerDB.get( `
        SELECT COUNT(*) AS CNTREC FROM pragma_table_info('${tableName}') WHERE name='${colName}'
        `, [], ( ex, row ) =>
		{
			if ( ex )
			{
				console.error( "Encountered error querying database: " + ex )
				reject( ex )
			}
			else
			{
				resolve( row.CNTREC == 1 )
			}
		} )
	} )
}

function addColumnToTable( tableName, column )
{
	return new Promise( ( resolve, reject ) =>
	{
		playerDB.run( `
        ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.type} ${column.modifier ? column.modifier : ""}
        `, ex =>
		{
			if ( ex )
			{
				console.error( "Encountered error adding column to database: " + ex )
				reject( ex )
			}
			else
			{
				console.log( `Added '${column.name}' column to the '${tableName}' table` )
				resolve()
			}
		} )
	} )
}

class PlayerAccount
{
	// mirrors account struct in db

	// string id
	// string currentAuthToken
	// int currentAuthTokenExpirationTime
	// string currentServerId
	// Buffer persistentDataBaseline

	constructor ( id, currentAuthToken, currentAuthTokenExpirationTime, currentServerId, persistentDataBaseline, lastAuthIp, username )
	{
		this.id = id
		this.currentAuthToken = currentAuthToken
		this.currentAuthTokenExpirationTime = currentAuthTokenExpirationTime
		this.currentServerId = currentServerId
		this.persistentDataBaseline = persistentDataBaseline
		this.lastAuthIp = lastAuthIp
		this.username = username
	}
}

module.exports = {
	AsyncGetPlayerByID: async function AsyncGetPlayerByID( id )
	{
		let row = await asyncDBGet( "SELECT * FROM accounts WHERE id = ?", [ id ] )

		if ( !row )
			return null

		return new PlayerAccount( row.id, row.currentAuthToken, row.currentAuthTokenExpirationTime, row.currentServerId, row.persistentDataBaseline, row.lastAuthIp, row.username )
	},

	AsyncGetPlayersByUsername: async function AsyncGetPlayerByUsername( username )
	{
		let rows = await asyncDBAll( "SELECT * FROM accounts WHERE username = ?", [ username ] )

		return rows.map( row => new PlayerAccount( row.id, row.currentAuthToken, row.currentAuthTokenExpirationTime, row.currentServerId, row.persistentDataBaseline, row.lastAuthIp, row.username ) )
	},

	AsyncCreateAccountForID: async function AsyncCreateAccountForID( id )
	{
		await asyncDBRun( "INSERT INTO accounts ( id, persistentDataBaseline ) VALUES ( ?, ? )", [ id, DEFAULT_PDATA_BASELINE ] )
	},

	AsyncUpdateCurrentPlayerAuthToken: async function AsyncUpdateCurrentPlayerAuthToken( id, token )
	{
		await asyncDBRun( "UPDATE accounts SET currentAuthToken = ?, currentAuthTokenExpirationTime = ? WHERE id = ?", [ token, Date.now() + TOKEN_EXPIRATION_TIME, id ] )
	},

	AsyncUpdatePlayerUsername: async function AsyncUpdatePlayerUsername( id, username )
	{
		await asyncDBRun( "UPDATE accounts SET username = ? WHERE id = ?", [ username, id ] )
	},

	AsyncUpdatePlayerAuthIp: async function AsyncUpdatePlayerAuthIp( id, lastAuthIp )
	{
		await asyncDBRun( "UPDATE accounts SET lastAuthIp = ? WHERE id = ?", [ lastAuthIp, id ] )
	},

	AsyncUpdatePlayerCurrentServer: async function AsyncUpdatePlayerCurrentServer( id, serverId )
	{
		await asyncDBRun( "UPDATE accounts SET currentServerId = ? WHERE id = ?", [ serverId, id ] )
	},

	AsyncWritePlayerPersistenceBaseline: async function AsyncWritePlayerPersistenceBaseline( id, persistentDataBaseline )
	{
		await asyncDBRun( "UPDATE accounts SET persistentDataBaseline = ? WHERE id = ?", [ persistentDataBaseline, id ] )
	},

	AsyncGetPlayerModPersistence: async function AsyncGetPlayerModPersistence( id, pdiffHash )
	{
		// prevent JSON parse problems when the user has no data in the database
		let result = await asyncDBGet( "SELECT data from modPersistentData WHERE id = ? AND pdiffHash = ?", [ id, pdiffHash ] )
		if ( result == undefined )
		{
			await asyncDBRun( "INSERT INTO modPersistentData ( id, pdiffHash, data ) VALUES ( ?, ?, ? )", [ id, pdiffHash, "{}" ] )
			result = await asyncDBGet( "SELECT data from modPersistentData WHERE id = ? AND pdiffHash = ?", [ id, pdiffHash ] )
		}
		return JSON.parse( result.data )
	},

	AsyncWritePlayerModPersistence: async function AsyncWritePlayerModPersistence( id, pdiffHash, data )
	{
		await asyncDBRun( "UPDATE modPersistentData SET data = ? WHERE id = ? AND pdiffHash = ?", [ data, id, pdiffHash ] )
		console.log( "successfully written pdiff data" )
	},

	AsyncModPersistenceBufferToJson: async function AsyncModPersistenceBufferToJson( modInfo, playerID, buffer )
	{
		// this returns an object in the form
		/*
		{
			baseline: <baseline> // this is the vanilla persistence, that we will write like normal (as a buffer)
			pdiffs: // array of all the mods and the persistence data they have stored
			[
				{
					hash: <hash>, // hashed string 
					data: <data>,  // Object
					pdef: <pdef> // Object (just used for temp storage tbh)
				},
				{
					hash: <hash>, // hashed string 
					data: <data>,  // Object
					pdef: <pdef> // Object (just used for temp storage tbh)
				},
				...
			]
		}
		*/

		let ret = {
			pdiffs: []
		}

		let pdiffs = modInfo.Mods.filter( m => !!m.Pdiff ).map( m => m.Pdiff )

		// i hate javascript so much
		let pdefCopy = { ...DEFAULT_PDEF_OBJECT }

		for ( let pdiffstr of pdiffs )
		{
			let pdiff
			if ( pdiffstr )
			{
				try
				{
					let pdiffHash = crypto.createHash( "sha1" ).update( pdiffstr ).digest( "hex" )
					pdiff = pjson.ParseDefinitionDiff( pdiffstr )
					pdiff.hash = pdiffHash
				}
				catch ( ex )
				{
					console.log( ex )
				}
			}

			for ( let enumAdd in pdiff.enumAdds )
			{
				pdefCopy.enums[ enumAdd ] = pdefCopy.enums[ enumAdd ].concat( pdiff.enumAdds[ enumAdd ] )
			}
			pdefCopy = objCombine( pdefCopy, pdiff.pdef )
			ret.pdiffs.push( { hash: pdiff.hash, pdef: pdiff.pdef, enumAdds: pdiff.enumAdds, data: {} } )
		}

		let parsed = pjson.PdataToJson( buffer, pdefCopy )

		// get the vanilla pdata we are already storing in the DB for the player, we will make changes to this and re-write it to the DB
		let player = await ( module.exports.AsyncGetPlayerByID( playerID ) )
		let vanillaPdata = await pjson.PdataToJson( player.persistentDataBaseline, { ...DEFAULT_PDEF_OBJECT } )

		// NEW STUFF
		// the pdata can be thought of like a tree, we need to find all the branches that are modified by the pdiffs
		// to do this we should recurse through each branch

		/*function RecursiveCheckPdata( pdata, pdiff )
		{
			Object.keys( pdata ).forEach( key =>
			{
				console.log( key )
				// checking if key was directly added by the pdiff
				let found = false
				pdiff.pdef.members.forEach( member =>
				{
					if ( member.name == key )
						found = true
				} )
				if ( found )
				{
					console.log( "KEY '" + key + "' WAS DIRECTLY ADDED BY PDIFF" )
				}
				else
				{
					console.log( "KEY '" + key + "' WAS DIRECTLY ADDED BY PDIFF" )
				}
				// checking array stuff
				if ( pdata[key].arraySize === undefined )
				{
					console.log( "KEY '" + key + "' IS NOT AN ARRAY" )
				}
				else if ( isNaN( Number( pdata[key].arraySize ) ) )
				{
					console.log( "KEY '" + key + "' IS AN ARRAY OF DYNAMIC LENGTH '" + pdata[key].arraySize + "'" )
				}
				else
				{
					console.log( "KEY '" + key + "' IS AN ARRAY OF FIXED LENGTH '" + pdata[key].arraySize + "'" )
				}
			} )
		}*/

		ret.pdiffs.forEach( pdiff =>
		{
			console.log( "FINDING PDATA CHANGES RELATED TO PDIFF '" + pdiff.hash + "'" )

			// look through the pdef members and find them in the pdata
			pdiff.pdef.members.forEach( member =>
			{
				console.log( member )

				// find data on the member from pdata
				console.assert( Object.keys( parsed ).includes( member.name ), "PDATA DOES NOT CONTAIN AN ENTRY FOR '" + member.name + "'" )
				let data = parsed[member.name]
				// add to ret
				pdiff.data[member.name] = data.value
			} )

			// find all instances of enumAdds being used TODO
		} )
		console.log( "DONE" )

		// OLD STUFF

		// iterate through the keys
		/*Object.keys( parsed ).forEach( key =>
		{
			// THIS IS PROBABLY MISSING SOME CASES

			// if key is directly added by a mod, add it to the mod's pdiff object
			let found = false
			ret.pdiffs.forEach( pdiff =>
			{
				pdiff.pdef.members.forEach( member =>
				{
					if ( key == member.name )
					{
						console.log( "key is a member defined in a pdiff" )

						console.log( key )
						console.log( parsed[key] )
						// this is currently adding it to *all* pdiffs that add the member, which is not ideal i don't think?
						// potential for two mods to have the same member, but implemented differently
						pdiff.data[key] = parsed[key]
						found = true
					}
				} )
			} )
			if ( found )
			{
				return // we have dealt with this key
			}
			// else if key is an enum member that is added by a mod, put it in the mod's pdiff object
			let type = parsed[key].type
			ret.pdiffs.forEach( pdiff =>
			{
				if ( typeof pdiff.pdef.enums[type] != "undefined" && pdiff.pdef.enums[type].includes( parsed[key].value ) ) // enums contains the type
				{
					console.log( "key is an enum member" )
					console.log( key )

					console.log( pdiff.pdef )
					console.log( parsed[key].value )

					pdiff.data[key] = parsed[key]
					found = true
				}

			} )
			if ( found )
			{
				return // we have dealt with this key
			}
			// else add to vanilla pdiff object
			vanillaPdata[key] = parsed[key]
			console.log( "key is not modded" )
			console.log( key )
		} )*/


		// convert the vanilla pdata to buffer and put it in ret.baseline to be written
		ret.baseline = pjson.PdataJsonToBuffer( vanillaPdata, { ...DEFAULT_PDEF_OBJECT } )

		return ret
	},

	// eslint-disable-next-line
	AsyncGetPlayerPersistenceBufferForMods: async function( id, pdiffs )
	{
		let player = await module.exports.AsyncGetPlayerByID( id )
		//return player.persistentDataBaseline

		let pdefCopy = { ...DEFAULT_PDEF_OBJECT }
		let baselineJson = pjson.PdataToJson( player.persistentDataBaseline, { ...DEFAULT_PDEF_OBJECT } )

		let newPdataJson = baselineJson

		if ( !player )
			return null

		// iterate through the mods which have pdiffs
		for ( let pdiffstr of pdiffs )
		{
			// get the hash and pdef for the pdiff so we can get the data and splice it properly
			let pdiff
			if ( pdiffstr )
			{
				try
				{
					let pdiffHash = crypto.createHash( "sha1" ).update( pdiffstr ).digest( "hex" )
					pdiff = pjson.ParseDefinitionDiff( pdiffstr )
					pdiff.hash = pdiffHash
				}
				catch ( ex )
				{
					console.log( ex )
				}
			}

			// add to the enums in the vanilla pdef
			for ( let enumAdd in pdiff.enumAdds )
			{
				pdefCopy.enums[ enumAdd ] = pdefCopy.enums[ enumAdd ].concat( pdiff.enumAdds[ enumAdd ] )
			}

			// This looks fine, don't really think it needs changing
			pdefCopy = objCombine( pdefCopy, pdiff.pdef )

			// example of result: {"moddedPilotWeapons":{"mp_weapon_peacekraber":"..."}}
			// second example: {"isPDiffWorking":1}}
			// TODO: support dot notation in the member names i.e ranked.isPlayingRanked
			// this format allows for dynamic editing of arrays with dynamic size
			// including the type in this json is irrelevant as we can get that from the pdef anyway
			let result = await module.exports.AsyncGetPlayerModPersistence( id, pdiff.hash )

			// iterate through the members of the data
			Object.keys( result ).forEach( pdiffMemberKey =>
			{
				let pdefObject
				pdefCopy.members.forEach( member =>
				{
					if ( member.name === pdiffMemberKey )
						pdefObject = member
				} )
				console.assert( pdefObject !== undefined, "Could not find key '" + pdiffMemberKey + "' in pdef" )

				// if this is not an array
				if ( pdefObject.arraySize === undefined )
				{
					// construct the Object that we are going to write to newPdataJson

					// get info from the pdiff pdef
					let write = { arraySize: pdefObject.arraySize, nativeArraySize: pdefObject.nativeArraySize, type: pdefObject.type }
					// get info from the pdiff data
					write.value = result[pdiffMemberKey]

					// write the value
					// we dont even check if the key exists or not here because we are kinda just blindly overriding, would be the mods fault if they break shit
					newPdataJson[pdiffMemberKey] = write
				}
				// if this is an array
				else
				{
					// construct base Object for the array (if needed)
					if ( newPdataJson[pdiffMemberKey] === undefined )
					{
						// get data from the pdef
						let length = pdefObject.arraySize
						if ( isNaN( Number( length ) ) )
						{
							length = pdefCopy.enums[pdefObject.arraySize].length
						}
						let write = { arraySize: length, nativeArraySize: pdefObject.nativeArraySize, type: pdefObject.type }
						write.value = []
						newPdataJson[pdiffMemberKey] = write
					}
					// iterate through each member of the array
					Object.keys( result[pdiffMemberKey] ).forEach( pdiffMemberDataKey =>
					{
						// convert the key into an index for the array
						let pdiffMemberDataKey_Number = Number( pdiffMemberDataKey )
						// i think this is safe because i dont think you can use numbers in enums for pdefs (game crashes afaik)
						// check if the key is actually an enum member
						if ( isNaN( pdiffMemberDataKey_Number ) )
						{
							// get the key's index from the enum
							for ( let i = 0; i < pdefCopy.enums[pdefObject.arraySize].length; i++ )
							{
								if ( pdefCopy.enums[pdefObject.arraySize][i] == pdiffMemberDataKey )
								{
									pdiffMemberDataKey_Number = i
									break
								}
							}
							console.assert( !isNaN( pdiffMemberDataKey_Number ), "Pdiff member's key '" + pdiffMemberDataKey + "' is not in the enum '" + pdefObject.arraySize + "'" )
						}
						// write the value
						newPdataJson[pdiffMemberKey].value[pdiffMemberDataKey_Number] = result[pdiffMemberKey][pdiffMemberDataKey]
					} )
				}
			}, { newPdataJson: newPdataJson } )

		}
		// SEEMS TO WORK UP TO HERE

		let ret
		try
		{
			ret = pjson.PdataJsonToBuffer( newPdataJson, pdefCopy )
		}
		catch ( ex )
		{
			console.log( ex )
		}
		return ret

	}
}

function objCombine( target, object )
{
	let combined = {}

	Object.keys( target ).forEach( key =>
	{
		if ( Array.isArray( target[key] ) )
		{
			if ( combined[key] == null )
				combined[key] = []

			// i dont see a nice way that we can override members, then again, you shouldn't ever need to? like what would be the point
			// i did the not-nice thing because i think we need to be able to override members for cases where pdiffs change, say a loadout index
			// this could make that loadout index not valid in non-modded pdata, for pdiff we split this into being stored in pdiff data
			// therefore we need to be able to override a member to load that pdiff data
			target[key].forEach( innerKey =>
			{
				let hasReplaced = false
				// try and replace a key in the combined object, if we can't replace, add to the end
				combined[key].forEach( otherKey =>
				{
					if ( !hasReplaced && otherKey.name == innerKey.name )
					{
						hasReplaced = true
						otherKey = innerKey
					}
				} )
				if ( !hasReplaced )
					combined[ key ].push( innerKey )

			} )
		}
		else
		{
			if ( combined[key] == null )
				combined[key] = {}
			Object.assign( combined[key], target[key] )
		}
	} )

	Object.keys( object ).forEach( key =>
	{
		if ( Array.isArray( object[key] ) )
		{
			if ( combined[key] == null )
				combined[key] = []
			object[key].forEach( innerKey =>
			{
				let hasReplaced = false
				// try and replace a key in the combined object, if we can't replace, add to the end
				combined[key].forEach( otherKey =>
				{
					if ( !hasReplaced && otherKey.name == innerKey.name )
					{
						hasReplaced = true
						otherKey = innerKey
					}
				} )
				if ( !hasReplaced )
					combined[ key ].push( innerKey )
			} )
		}
		else
		{
			if ( combined[key] == null )
				combined[key] = {}
			Object.assign( combined[key], object[key] )
		}
	} )

	return combined
}


